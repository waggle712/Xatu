import { useInfiniteQuery } from '@tanstack/react-query';
import type { FeedPage, SearchPage } from '@xatu/shared';
import { apiRequest } from '../../lib/api';

export type Point = { lat: number; lng: number } | null;

const where = (point: Point) => (point ? `&lat=${point.lat}&lng=${point.lng}` : '');

/** Home feed. Persisted for offline use (query key root 'feed'); never contains personal data. */
export function useFeed(point: Point, category: string | null) {
  return useInfiniteQuery({
    queryKey: ['feed', point?.lat ?? null, point?.lng ?? null, category],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiRequest<FeedPage>(
        `/feed?radiusKm=25${where(point)}${category ? `&category=${category}` : ''}${
          pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
        }`,
        { auth: false },
      ),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 60_000,
  });
}

/** Search results. Not persisted. */
export function useSearch(q: string, point: Point) {
  return useInfiniteQuery({
    queryKey: ['search', q, point?.lat ?? null, point?.lng ?? null],
    enabled: q.length > 0,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiRequest<SearchPage>(
        `/search?q=${encodeURIComponent(q)}${where(point)}${
          pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
        }`,
        { auth: false },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}
