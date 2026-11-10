import type { MediaAsset, MediaPurpose, UploadTicket } from '@xatu/shared';
import { createUploadTask, FileSystemUploadType, getInfoAsync } from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { fitWithin } from './prepare';

export type UploadState =
  | { step: 'idle' }
  | { step: 'preparing' }
  | { step: 'uploading'; progress: number }
  | { step: 'processing' }
  | { step: 'ready'; asset: MediaAsset }
  | {
      step: 'failed';
      reason: 'permission' | 'network' | 'rejected' | 'timeout' | 'unknown';
      rejectReason?: string;
    };

interface Prepared {
  uri: string;
  byteSize: number;
  capturedInApp: boolean;
}

const POLL_MS = 1_000;
const POLL_LIMIT = 90;

/**
 * Pick (library or camera, with crop) → compress on the phone → signed PUT straight to storage
 * with progress → tell the API → wait until the worker marks it ready. retry() resumes after a
 * failure without asking the person to pick the photo again.
 */
export function useImageUpload(purpose: MediaPurpose, aspect: [number, number]) {
  const [state, setState] = useState<UploadState>({ step: 'idle' });
  const prepared = useRef<Prepared | null>(null);
  const cancelled = useRef(false);

  const send = useCallback(
    async (file: Prepared): Promise<MediaAsset | null> => {
      try {
        setState({ step: 'uploading', progress: 0 });
        const ticket = await apiRequest<UploadTicket>('/media/uploads', {
          method: 'POST',
          body: {
            purpose,
            contentType: 'image/jpeg',
            byteSize: file.byteSize,
            capturedInApp: file.capturedInApp,
          },
        });
        const task = createUploadTask(
          ticket.uploadUrl,
          file.uri,
          {
            httpMethod: 'PUT',
            uploadType: FileSystemUploadType.BINARY_CONTENT,
            headers: ticket.headers,
          },
          ({ totalBytesSent, totalBytesExpectedToSend }) => {
            if (totalBytesExpectedToSend > 0)
              setState({ step: 'uploading', progress: totalBytesSent / totalBytesExpectedToSend });
          },
        );
        const result = await task.uploadAsync();
        if (!result || result.status < 200 || result.status >= 300)
          throw new Error(`Upload failed (${result?.status ?? 'no response'})`);

        setState({ step: 'processing' });
        let asset = await apiRequest<MediaAsset>(`/media/${ticket.mediaId}/complete`, {
          method: 'POST',
        });
        for (let i = 0; asset.status === 'pending' || asset.status === 'processing'; i++) {
          if (cancelled.current) return null;
          if (i >= POLL_LIMIT) {
            setState({ step: 'failed', reason: 'timeout' });
            return null;
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
          asset = await apiRequest<MediaAsset>(`/media/${ticket.mediaId}`);
        }
        if (asset.status === 'rejected') {
          setState({
            step: 'failed',
            reason: 'rejected',
            rejectReason: asset.rejectReason ?? undefined,
          });
          return null;
        }
        setState({ step: 'ready', asset });
        return asset;
      } catch (err) {
        setState({
          step: 'failed',
          reason:
            err instanceof Error && /network|failed/i.test(err.message) ? 'network' : 'unknown',
        });
        return null;
      }
    },
    [purpose],
  );

  const pick = useCallback(
    async (source: 'library' | 'camera'): Promise<MediaAsset | null> => {
      cancelled.current = false;
      const perm =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setState({ step: 'failed', reason: 'permission' });
        return null;
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect,
        quality: 1,
        exif: false,
      };
      const picked =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      const image = picked.canceled ? undefined : picked.assets[0];
      if (!image) return null;

      setState({ step: 'preparing' });
      // Compress on the phone: smaller uploads on weak 4G, and the server never needs more than 2048px.
      const context = ImageManipulator.manipulate(image.uri);
      const size = fitWithin(image.width, image.height);
      if (size) context.resize(size);
      const rendered = await (
        await context.renderAsync()
      ).saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
      const info = await getInfoAsync(rendered.uri);
      if (!info.exists) {
        setState({ step: 'failed', reason: 'unknown' });
        return null;
      }
      prepared.current = {
        uri: rendered.uri,
        byteSize: info.size,
        capturedInApp: source === 'camera',
      };
      return send(prepared.current);
    },
    [aspect, send],
  );

  const retry = useCallback(async () => (prepared.current ? send(prepared.current) : null), [send]);
  const reset = useCallback(() => {
    cancelled.current = true;
    prepared.current = null;
    setState({ step: 'idle' });
  }, []);

  return { state, pick, retry, reset };
}
