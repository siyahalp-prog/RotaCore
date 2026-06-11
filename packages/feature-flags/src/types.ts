export type FeatureFlag = {
  key: string;
  description: string;
  /** Master switch: when false, the flag is off for everyone. */
  enabled: boolean;
  /** 0-100. When set, only this percentage of users (stable per user) get the flag. */
  rolloutPercentage?: number | undefined;
  /** When set, users with any of these roles get the flag (e.g. ['admin', 'beta']). */
  allowedRoles?: string[] | undefined;
  /** When set, these specific users always get the flag. */
  allowedUserIds?: string[] | undefined;
  updatedAt: Date;
};

export type FlagContext = {
  userId?: string;
  roles?: string[];
};

export type UpsertFlagInput = {
  key: string;
  description?: string;
  enabled: boolean;
  rolloutPercentage?: number;
  allowedRoles?: string[];
  allowedUserIds?: string[];
};
