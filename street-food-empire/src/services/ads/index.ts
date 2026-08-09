export {
  adService,
  canOpenFreeCrate,
  canShowInterstitial,
  canShowRewarded,
  hasRemoveAds,
  noteFreeCrateOpened,
  noteInterstitialShown,
  noteRewardedWatched,
  noteSignificantEvent,
  rewardIsFree,
  type AdGate,
} from '@/services/ads/AdService';
export { MockAdProvider } from '@/services/ads/MockAdProvider';
export { REWARDED_LABELS } from '@/services/ads/types';
export type {
  AdLoadState,
  AdProvider,
  InterstitialResult,
  RewardedPlacement,
  RewardedResult,
} from '@/services/ads/types';
