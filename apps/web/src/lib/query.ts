import { QueryClient } from '@tanstack/react-query';

// Shared client so the WebSocket dispatcher can invalidate queries on deltas.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
});
