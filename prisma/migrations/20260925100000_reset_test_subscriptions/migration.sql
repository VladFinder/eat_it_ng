UPDATE "Household"
SET "plan" = 'free',
    "subscriptionStatus" = 'inactive',
    "subscriptionProvider" = 'none',
    "subscriptionPeriodEnd" = NULL
WHERE "subscriptionProvider" = 'admin';
