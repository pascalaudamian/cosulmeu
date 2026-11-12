import useSWR from 'swr';
import { loadDashboardData, type DashboardData } from './DashboardDataService.js';

const fetchDashboard = ([, userId]: readonly [string, string]) => loadDashboardData(userId);

export function useDashboardData(userId?: string) {
  return useSWR<DashboardData>(
    userId ? ['dashboard-data', userId] as const : null,
    fetchDashboard,
    {
      dedupingInterval: 30_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true
    }
  );
}
