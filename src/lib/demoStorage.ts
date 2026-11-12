import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TripItem } from '../utils/journey';
import { DEFAULT_DEMO_PRICING_POLICY, isDemoServiceFeeRate } from '../utils/pricingPolicy';
import type { DemoBooking } from '../utils/pricingPolicy';

const STORAGE_KEY = '@buzios-flow/demo-state-v1';

export type DemoStoredState = {
  schemaVersion: 1;
  tripItems: TripItem[];
  bookings: DemoBooking[];
  serviceFeeRate: number;
};

export const DEFAULT_DEMO_STORED_STATE: DemoStoredState = {
  schemaVersion: 1,
  tripItems: [],
  bookings: [],
  serviceFeeRate: DEFAULT_DEMO_PRICING_POLICY.serviceFeeRate,
};

export async function loadDemoState(): Promise<DemoStoredState> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_DEMO_STORED_STATE;

    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_DEMO_STORED_STATE;

    const value = parsed as Partial<DemoStoredState>;
    return {
      schemaVersion: 1,
      tripItems: Array.isArray(value.tripItems) ? value.tripItems : [],
      bookings: Array.isArray(value.bookings) ? value.bookings : [],
      serviceFeeRate: isDemoServiceFeeRate(value.serviceFeeRate ?? -1)
        ? value.serviceFeeRate!
        : DEFAULT_DEMO_STORED_STATE.serviceFeeRate,
    };
  } catch {
    return DEFAULT_DEMO_STORED_STATE;
  }
}

export async function saveDemoState(state: DemoStoredState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function clearDemoState(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}