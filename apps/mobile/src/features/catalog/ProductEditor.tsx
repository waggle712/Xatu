import {
  type FulfilmentMode,
  formatPaise,
  MAX_LEAD_TIME_DAYS,
  MAX_PRODUCT_PHOTOS,
  MAX_STOCK,
  type MyShop,
  type ProductDraft,
  type PublishProblem,
  type SellerProduct,
  type VariantInput,
} from '@xatu/shared';
import { Button, Chip, Text, useTheme } from '@xatu/ui';
import { router } from 'expo-router';
import { Camera, ImagePlus, Star, Trash2, X } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { ToggleRow } from '../../components/Rows';
import { TextField } from '../../components/TextField';
import { XImage } from '../../components/XImage';
import { errorMessage } from '../../lib/errors';
import { uuidv4 } from '../../lib/uuid';
import { useImageUpload } from '../media/useImageUpload';
import { useCategories } from '../shop/api';
import { saveDraft, useApplyProduct, useProductAction, useSetPhotos } from './api';
import { StatusPill, Stepper, UploadProgress } from './parts';
import { paiseToRupeesInput, rupeesToPaise } from './price';
import { useAutosave } from './useAutosave';

type Step = 1 | 2 | 3;
const STEP_NAMES = { 1: 'photos', 2: 'details', 3: 'review' } as const;
const PROBLEM_STEP: Record<PublishProblem, Step> = {
  photo: 1,
  title: 2,
  category: 2,
  price: 2,
  lead_time: 2,
  fulfilment: 2,
};

interface Row {
  key: string;
  id?: string;
  label: string;
  labelTa: string;
  price: string;
  stock: number;
}

const toRows = (p: SellerProduct): Row[] =>
  p.variants.length > 0
    ? p.variants.map((v) => ({
        key: v.id,
        id: v.id,
        label: v.label ?? '',
        labelTa: v.labelTa ?? '',
        price: paiseToRupeesInput(v.pricePaise),
        stock: v.stock,
      }))
    : [{ key: uuidv4(), label: '', labelTa: '', price: '', stock: 1 }];

/**
 * Listing flow (Seller listing design): photos first, then details, then review and publish.
 * Every change autosaves the draft; a live product stays live while it's edited.
 */
export function ProductEditor({
  product,
  shop,
  isNew,
}: {
  product: SellerProduct;
  shop: MyShop;
  isNew: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [step, setStep] = useState<Step>(
    product.status === 'archived' ? 3 : isNew || product.photos.length === 0 ? 1 : 2,
  );
  const apply = useApplyProduct();
  const [rows, setRows] = useState<Row[]>(() => toRows(product));
  /** Which local rows a sent variant list belongs to, so new variants learn their server ids. */
  const sentKeys = useRef(new WeakMap<VariantInput[], string[]>());

  const onSaved = useCallback(
    (saved: SellerProduct, sent: ProductDraft) => {
      apply(saved);
      const keys = sent.variants ? sentKeys.current.get(sent.variants) : undefined;
      if (!keys || saved.variants.length !== keys.length) return;
      setRows((current) =>
        current.map((row) => {
          const i = keys.indexOf(row.key);
          return i >= 0 && !row.id ? { ...row, id: saved.variants[i]!.id } : row;
        }),
      );
    },
    [apply],
  );
  const autosave = useAutosave((patch) => saveDraft(product.id, patch), onSaved);

  const go = async (next: Step) => {
    await autosave.flush();
    setStep(next);
  };

  return (
    <View style={{ gap: theme.space[4], flexGrow: 1 }}>
      <Header
        title={t(isNew ? 'catalog.newTitle' : 'catalog.editTitle')}
        step={step}
        onStep={(s) => void go(s)}
        saveText={autosave.status === 'idle' ? '' : t(`catalog.save.${autosave.status}`)}
        saveError={autosave.status === 'error'}
      />
      {step === 1 ? <PhotosStep product={product} /> : null}
      {step === 2 ? (
        <DetailsStep
          product={product}
          shop={shop}
          rows={rows}
          setRows={setRows}
          schedule={(patch, keys) => {
            if (patch.variants && keys) sentKeys.current.set(patch.variants, keys);
            autosave.schedule(patch);
          }}
        />
      ) : null}
      {step === 3 ? (
        <ReviewStep
          product={product}
          shop={shop}
          flush={autosave.flush}
          onFix={(s) => void go(s)}
        />
      ) : null}

      {step < 3 ? (
        <View style={{ marginTop: 'auto', flexDirection: 'row', gap: theme.space[2] }}>
          {step > 1 ? (
            <Button
              variant="secondary"
              label={t('catalog.back')}
              onPress={() => void go((step - 1) as Step)}
              style={{ flex: 1 }}
            />
          ) : null}
          <Button
            label={t('catalog.next')}
            disabled={step === 1 && product.photos.length === 0}
            onPress={() => void go((step + 1) as Step)}
            style={{ flex: 2 }}
          />
        </View>
      ) : null}
    </View>
  );
}

function Header({
  title,
  step,
  onStep,
  saveText,
  saveError,
}: {
  title: string;
  step: Step;
  onStep: (step: Step) => void;
  saveText: string;
  saveError: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('catalog.close')}
          onPress={() => router.back()}
          style={{ width: 48, height: 48, justifyContent: 'center', marginLeft: -12 }}
        >
          <X
            size={26}
            strokeWidth={1.75}
            color={theme.colors.ink}
            style={{ alignSelf: 'center' }}
          />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="heading" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="caption" color="inkMuted">
            {t('catalog.stepOf', { step, name: t(`catalog.steps.${STEP_NAMES[step]}`) })}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[1] }} accessibilityRole="tablist">
        {([1, 2, 3] as const).map((s) => (
          <Pressable
            key={s}
            accessibilityRole="tab"
            accessibilityLabel={t(`catalog.steps.${STEP_NAMES[s]}`)}
            accessibilityState={{ selected: s === step }}
            onPress={() => onStep(s)}
            style={{ flex: 1, height: 24, justifyContent: 'center' }}
          >
            <View
              style={{
                height: 6,
                borderRadius: 3,
                backgroundColor: s <= step ? theme.colors.ink : theme.colors.line,
              }}
            />
          </Pressable>
        ))}
      </View>
      {saveText ? (
        <Text
          variant="caption"
          color={saveError ? 'critical' : 'inkMuted'}
          accessibilityLiveRegion="polite"
        >
          {saveText}
        </Text>
      ) : null}
    </View>
  );
}

// ───────────────────────────── Step 1: photos ─────────────────────────────

function PhotosStep({ product }: { product: SellerProduct }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const upload = useImageUpload('product_photo', [1, 1]);
  const setPhotos = useSetPhotos(product.id);
  const ids = product.photos.map((p) => p.id);
  const tile = Math.floor((Math.min(width, 600) - theme.space[4] * 2 - theme.space[2] * 2) / 3);
  const busy =
    upload.state.step === 'preparing' ||
    upload.state.step === 'uploading' ||
    upload.state.step === 'processing' ||
    setPhotos.isPending;
  const full = ids.length >= MAX_PRODUCT_PHOTOS;

  const add = async (source: 'library' | 'camera') => {
    const asset = await upload.pick(source);
    if (asset) setPhotos.mutate([...ids, asset.id], { onSuccess: () => upload.reset() });
  };

  return (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="heading">{t('catalog.photos.title')}</Text>
      <Text variant="label" color="inkMuted">
        {t('catalog.photos.hint')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {product.photos.map((photo, i) => (
          <View key={photo.id} style={{ width: tile, gap: theme.space[1] }}>
            <XImage
              image={photo}
              aspectRatio={1}
              borderRadius={theme.radius.md}
              accessibilityLabel={t('catalog.photos.photo', { n: i + 1, count: ids.length })}
            />
            {i === 0 ? (
              <View
                style={{
                  position: 'absolute',
                  top: 6,
                  left: 6,
                  paddingHorizontal: 8,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.colors.plum,
                }}
              >
                <Text variant="caption" color="onPlum">
                  {t('catalog.photos.cover')}
                </Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
              {i > 0 ? (
                <IconButton
                  label={t('catalog.photos.makeCover', { n: i + 1 })}
                  disabled={busy}
                  onPress={() =>
                    setPhotos.mutate([photo.id, ...ids.filter((id) => id !== photo.id)])
                  }
                >
                  <Star size={20} strokeWidth={1.75} color={theme.colors.ink} />
                </IconButton>
              ) : null}
              <IconButton
                label={t('catalog.photos.remove', { n: i + 1 })}
                disabled={busy || (ids.length === 1 && product.status !== 'draft')}
                onPress={() => setPhotos.mutate(ids.filter((id) => id !== photo.id))}
              >
                <Trash2 size={20} strokeWidth={1.75} color={theme.colors.critical} />
              </IconButton>
            </View>
          </View>
        ))}
      </View>

      <UploadProgress state={upload.state} />
      {setPhotos.isError ? (
        <Text variant="label" color="critical" accessibilityLiveRegion="polite">
          {errorMessage(setPhotos.error, t)}
        </Text>
      ) : null}
      {full ? (
        <Text variant="label" color="inkMuted">
          {t('catalog.photos.max')}
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', gap: theme.space[2], flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            label={t('media.library')}
            disabled={busy}
            icon={<ImagePlus size={18} strokeWidth={1.75} color={theme.colors.ink} />}
            onPress={() => void add('library')}
            style={{ flexGrow: 1 }}
          />
          <Button
            variant="secondary"
            label={t('media.camera')}
            disabled={busy}
            icon={<Camera size={18} strokeWidth={1.75} color={theme.colors.ink} />}
            onPress={() => void add('camera')}
            style={{ flexGrow: 1 }}
          />
        </View>
      )}
      {upload.state.step === 'failed' &&
      ['network', 'timeout', 'unknown'].includes(upload.state.reason) ? (
        <Button
          variant="secondary"
          label={t('media.retry')}
          onPress={() =>
            void upload.retry().then((asset) => asset && setPhotos.mutate([...ids, asset.id]))
          }
        />
      ) : null}
    </View>
  );
}

function IconButton({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={(s) => ({
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : s.pressed ? 0.7 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

// ───────────────────────────── Step 2: details ─────────────────────────────

function DetailsStep({
  product,
  shop,
  rows,
  setRows,
  schedule,
}: {
  product: SellerProduct;
  shop: MyShop;
  rows: Row[];
  setRows: React.Dispatch<React.SetStateAction<Row[]>>;
  schedule: (patch: ProductDraft, variantKeys?: string[]) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const categories = useCategories();
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [madeToOrder, setMadeToOrder] = useState(product.madeToOrder);
  const [leadTime, setLeadTime] = useState(product.leadTimeDays ?? 2);
  const [modes, setModes] = useState<FulfilmentMode[]>(product.fulfilmentModes);
  const offered: FulfilmentMode[] = [
    ...(shop.pickupAvailable ? (['pickup'] as const) : []),
    ...(shop.localDelivery ? (['local_delivery'] as const) : []),
  ];
  const multiple = rows.length > 1;

  const text = (field: 'title' | 'titleTa' | 'description' | 'descriptionTa') => (v: string) =>
    schedule({ [field]: v.trim() || null });

  /** Sends the variant list only when every row is valid; otherwise the field shows why. */
  const updateRows = (next: Row[]) => {
    setRows(next);
    const priced = next.map((r) => rupeesToPaise(r.price));
    const labelled = next.length === 1 || next.every((r) => r.label.trim().length > 0);
    if (priced.some((p) => p === null) || !labelled) return;
    const variants: VariantInput[] = next.map((r, i) => ({
      ...(r.id ? { id: r.id } : {}),
      label: next.length === 1 ? null : r.label.trim(),
      labelTa: next.length === 1 ? null : r.labelTa.trim() || null,
      pricePaise: priced[i]!,
      stock: r.stock,
    }));
    schedule(
      { variants },
      next.map((r) => r.key),
    );
  };
  const patchRow = (key: string, change: Partial<Row>) =>
    updateRows(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));

  return (
    <View style={{ gap: theme.space[4] }}>
      <TextField
        label={t('catalog.details.nameEn')}
        defaultValue={product.title ?? ''}
        onChangeText={text('title')}
        maxLength={80}
      />
      <TextField
        label={t('catalog.details.nameTa')}
        defaultValue={product.titleTa ?? ''}
        onChangeText={text('titleTa')}
        maxLength={80}
      />

      <Text variant="label" color="inkMuted">
        {t('catalog.details.category')}
      </Text>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}
        accessibilityRole="radiogroup"
      >
        {(categories.data ?? []).map((c) => (
          <Chip
            key={c.id}
            label={`${c.nameTa} · ${c.nameEn}`}
            selected={categoryId === c.id}
            onPress={() => {
              setCategoryId(c.id);
              schedule({ categoryId: c.id });
            }}
          />
        ))}
      </View>

      {rows.map((row, i) => (
        <View
          key={row.key}
          style={{
            gap: theme.space[3],
            ...(multiple
              ? {
                  padding: theme.space[3],
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.line,
                }
              : {}),
          }}
        >
          {multiple ? (
            <>
              <TextField
                label={t('catalog.details.optionName')}
                defaultValue={row.label}
                onChangeText={(label) => patchRow(row.key, { label })}
                maxLength={40}
                error={row.label.trim() ? null : ' '}
              />
              <TextField
                label={t('catalog.details.optionNameTa')}
                defaultValue={row.labelTa}
                onChangeText={(labelTa) => patchRow(row.key, { labelTa })}
                maxLength={40}
              />
            </>
          ) : null}
          <TextField
            label={t('catalog.details.price')}
            defaultValue={row.price}
            onChangeText={(price) => patchRow(row.key, { price })}
            keyboardType="decimal-pad"
            maxLength={10}
            prefix={<Text color="inkMuted">₹</Text>}
            error={
              row.price && rupeesToPaise(row.price) === null
                ? t('catalog.details.priceInvalid')
                : null
            }
          />
          <Text variant="caption" color="inkMuted" style={{ marginTop: -theme.space[2] }}>
            {t('catalog.details.inclGst')}
          </Text>
          <Stepper
            label={t('catalog.details.stock')}
            value={row.stock}
            min={0}
            max={MAX_STOCK}
            onChange={(stock) => patchRow(row.key, { stock })}
          />
          {multiple ? (
            <Button
              variant="secondary"
              label={t('catalog.details.removeOption')}
              icon={<Trash2 size={18} strokeWidth={1.75} color={theme.colors.critical} />}
              onPress={() => updateRows(rows.filter((r) => r.key !== row.key))}
              accessibilityHint={`${i + 1}`}
            />
          ) : null}
        </View>
      ))}
      <View style={{ gap: theme.space[1] }}>
        <Button
          variant="secondary"
          label={t('catalog.details.addOption')}
          disabled={rows.length >= 20}
          onPress={() =>
            updateRows([
              ...rows,
              {
                key: uuidv4(),
                label: '',
                labelTa: '',
                price: rows[rows.length - 1]?.price ?? '',
                stock: 1,
              },
            ])
          }
        />
        <Text variant="caption" color="inkMuted">
          {t('catalog.details.optionsHint')}
        </Text>
      </View>

      <TextField
        label={t('catalog.details.descriptionEn')}
        defaultValue={product.description ?? ''}
        onChangeText={text('description')}
        multiline
        maxLength={2000}
        style={{ minHeight: 100, textAlignVertical: 'top' }}
      />
      <TextField
        label={t('catalog.details.descriptionTa')}
        defaultValue={product.descriptionTa ?? ''}
        onChangeText={text('descriptionTa')}
        multiline
        maxLength={2000}
        style={{ minHeight: 100, textAlignVertical: 'top' }}
      />

      <View style={{ gap: theme.space[1] }}>
        <ToggleRow
          label={t('catalog.details.madeToOrder')}
          value={madeToOrder}
          onChange={(v) => {
            setMadeToOrder(v);
            schedule(v ? { madeToOrder: true, leadTimeDays: leadTime } : { madeToOrder: false });
          }}
        />
        <Text variant="caption" color="inkMuted">
          {t('catalog.details.madeToOrderHint')}
        </Text>
      </View>
      {madeToOrder ? (
        <Stepper
          label={t('catalog.details.leadTime')}
          value={leadTime}
          min={1}
          max={MAX_LEAD_TIME_DAYS}
          onChange={(days) => {
            setLeadTime(days);
            schedule({ leadTimeDays: days });
          }}
        />
      ) : null}

      <Text variant="label" color="inkMuted">
        {t('catalog.details.fulfilment')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {offered.map((mode) => {
          const selected = modes.includes(mode);
          return (
            <Chip
              key={mode}
              label={t(`catalog.details.modes.${mode}`)}
              selected={selected}
              onPress={() => {
                const next = selected ? modes.filter((m) => m !== mode) : [...modes, mode];
                if (next.length === 0) return; // at least one way to get it
                setModes(next);
                schedule({ fulfilmentModes: next });
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

// ───────────────────────────── Step 3: review ─────────────────────────────

function ReviewStep({
  product,
  shop,
  flush,
  onFix,
}: {
  product: SellerProduct;
  shop: MyShop;
  flush: () => Promise<boolean>;
  onFix: (step: Step) => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const action = useProductAction(product.id);
  const [done, setDone] = useState(false);
  const title = (i18n.language === 'ta' ? product.titleTa || product.title : product.title) ?? '';
  const prices = product.variants.map((v) => v.pricePaise);
  const stock = product.variants.reduce((s, v) => s + v.stock, 0);
  const problems = product.publishProblems;
  const shopReady = shop.status === 'active';

  const run = async (name: Parameters<typeof action.mutate>[0]) => {
    if (!(await flush())) return;
    action.mutate(name, {
      onSuccess: (p) => {
        if (name === 'publish' && p.status === 'active') setDone(true);
      },
    });
  };

  return (
    <View style={{ gap: theme.space[4], flexGrow: 1 }}>
      <Text variant="heading">{t('catalog.review.title')}</Text>
      <View
        style={{
          flexDirection: 'row',
          gap: theme.space[3],
          padding: theme.space[3],
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.line,
          backgroundColor: theme.colors.surfaceRaised,
        }}
      >
        <View style={{ width: 96 }}>
          <XImage
            image={product.photos[0] ?? null}
            aspectRatio={1}
            borderRadius={theme.radius.sm}
            accessibilityLabel={title || t('catalog.untitled')}
          />
        </View>
        <View style={{ flex: 1, gap: theme.space[1] }}>
          <StatusPill status={product.status} />
          <Text variant="heading" numberOfLines={3}>
            {title || t('catalog.untitled')}
          </Text>
          {prices.length > 0 ? (
            <Text variant="price">
              {prices.length > 1
                ? t('catalog.from', { price: formatPaise(Math.min(...prices)) })
                : formatPaise(prices[0]!)}
            </Text>
          ) : null}
          <Text variant="caption" color="inkMuted">
            {product.madeToOrder && product.leadTimeDays
              ? t('catalog.madeToOrderDays', { count: product.leadTimeDays })
              : stock > 0
                ? t('catalog.inStock', { count: stock })
                : t('catalog.soldOut')}
          </Text>
        </View>
      </View>

      {problems.length > 0 ? (
        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" color="inkMuted">
            {t('catalog.review.missing')}
          </Text>
          {problems.map((p) => (
            <Pressable
              key={p}
              accessibilityRole="button"
              onPress={() => onFix(PROBLEM_STEP[p])}
              style={{
                minHeight: 48,
                justifyContent: 'center',
                paddingHorizontal: theme.space[3],
                borderRadius: theme.radius.sm,
                backgroundColor: theme.colors.surfaceWarm,
              }}
            >
              <Text>{t(`catalog.review.problems.${p}`)}</Text>
            </Pressable>
          ))}
        </View>
      ) : product.status === 'draft' ? (
        <Text color="sage">
          {shopReady ? t('catalog.review.ready') : t('catalog.review.shopNotActive')}
        </Text>
      ) : null}

      {product.moderationStatus === 'held' ? (
        <Text color="critical">{t('catalog.review.held')}</Text>
      ) : null}
      {done ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            padding: theme.space[4],
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.sageSoft,
          }}
        >
          <Text color="sage">{t('catalog.review.published')}</Text>
        </View>
      ) : null}
      {action.isError ? (
        <Text variant="label" color="critical" accessibilityLiveRegion="polite">
          {errorMessage(action.error, t)}
        </Text>
      ) : null}

      <View style={{ marginTop: 'auto', gap: theme.space[2] }}>
        {product.status === 'draft' ? (
          <Button
            label={t('catalog.review.publish')}
            disabled={problems.length > 0 || !shopReady}
            loading={action.isPending}
            onPress={() => void run('publish')}
          />
        ) : null}
        {product.status === 'paused' ? (
          <Button
            label={t('catalog.review.resume')}
            loading={action.isPending}
            onPress={() => void run('resume')}
          />
        ) : null}
        {product.status === 'active' ? (
          <Button
            variant="secondary"
            label={t('catalog.review.pause')}
            loading={action.isPending}
            onPress={() => void run('pause')}
          />
        ) : null}
        {product.status === 'archived' ? (
          <Button
            variant="secondary"
            label={t('catalog.review.restore')}
            loading={action.isPending}
            onPress={() => void run('restore')}
          />
        ) : (
          <Button
            variant="secondary"
            label={t('catalog.review.archive')}
            disabled={action.isPending}
            onPress={() => void run('archive')}
          />
        )}
        {done ? (
          <Button variant="secondary" label={t('catalog.close')} onPress={() => router.back()} />
        ) : null}
      </View>
    </View>
  );
}
