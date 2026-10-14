import { recipeMealTypes } from './recipe-types.mjs';
import { z } from 'zod';

export const units = ['шт.', 'г', 'кг', 'мг', 'мл', 'л', 'упак.', 'бан.', 'бут.'];
export const categories = ['products', 'household', 'medicine'];

const name = z.string().trim().min(1).max(120);
const quantity = z.number().positive().max(1_000_000);
const unit = z.enum(units);
const date = z.iso.date();
const reminderDays = z.number().int().min(0).max(365);
const category = z.enum(categories);
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const password = z.string().min(8).max(128);
const supportSubject = z.string().trim().min(3).max(140);
const supportBody = z.string().trim().min(2).max(4_000);
const feedbackType = z.enum(['idea', 'bug', 'other']);

export const registerSchema = z.object({
  displayName: name,
  email,
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const householdUpdateSchema = z.object({
  name,
});

export const householdMemberSchema = z.object({
  email,
});

export const notificationUpdateSchema = z.object({
  read: z.boolean(),
});

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const notificationPreferencesSchema = z.object({
  notifyExpiry: z.boolean(),
  notifyShopping: z.boolean(),
  quietHoursStart: time.nullable(),
  quietHoursEnd: time.nullable(),
  timezone: z.string().trim().min(1).max(100),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .trim()
    .url()
    .max(2_000)
    .refine(isTrustedPushEndpoint, 'Unsupported push endpoint'),
  keys: z.object({
    p256dh: z.string().trim().min(20).max(500),
    auth: z.string().trim().min(8).max(500),
  }),
});

export function isTrustedPushEndpoint(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(
        url.hostname,
      ) ||
        url.hostname.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().trim().url().max(2_000),
});

const fridgeFields = {
  name,
  quantity,
  unit,
  expiresAt: date.nullable(),
  reminderDays,
  autoAddToShopping: z.boolean(),
  category,
};

export const fridgeCreateSchema = z.object({
  ...fridgeFields,
  reminderDays: reminderDays.default(1),
  autoAddToShopping: z.boolean().default(false),
  category: category.default('products'),
});

export const fridgeUpdateSchema = z
  .object(fridgeFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const consumeSchema = z.object({
  quantity,
});

const shoppingFields = {
  name,
  quantity,
  unit,
  category,
};

export const shoppingCreateSchema = z.object({
  name,
  quantity: quantity.default(1),
  unit: unit.default('шт.'),
  category: category.default('products'),
});

export const shoppingUpdateSchema = z
  .object({
    name: shoppingFields.name.optional(),
    quantity: quantity.nullable().optional(),
    unit: unit.nullable().optional(),
    category: shoppingFields.category.optional(),
    checked: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const shoppingToFridgeSchema = z.object({
  quantity: quantity.optional(),
  unit: unit.optional(),
  expiresAt: date.nullable(),
  reminderDays: reminderDays.optional(),
  category: category.optional(),
});

export const supportTicketCreateSchema = z.object({
  subject: supportSubject,
  message: supportBody,
});

export const supportMessageCreateSchema = z.object({
  message: supportBody,
});

export const feedbackCreateSchema = z.object({
  type: feedbackType.default('other'),
  message: supportBody,
});

const mealTypes = z
  .array(z.enum(recipeMealTypes))
  .max(11)
  .transform((types) => [...new Set(types)]);

export const dishCreateSchema = z.object({
  mealTypes: mealTypes.optional(),
  title: name,
  description: z.string().trim().max(600).optional(),
  imageUrl: z
    .string()
    .trim()
    .url()
    .max(1000)
    .refine((value) => /^https?:\/\//i.test(value), 'Нужна ссылка http или https')
    .nullable()
    .optional(),
  ingredients: z
    .array(name.refine((value) => /[\p{L}\p{N}]/u.test(value)))
    .min(1)
    .max(20),
  instructions: z.array(z.string().trim().min(1).max(1000)).min(1).max(30).optional(),
  preparationMinutes: z.number().int().min(1).max(1440).nullable().optional(),
});

export const mealPlanCreateSchema = z.object({
  dishId: z.string().trim().min(1).max(200),
  date,
  mealType: z.enum(['breakfast', 'lunch', 'dinner']).default('dinner'),
});

export const adminSubscriptionSchema = z.object({
  active: z.boolean(),
  periodEnd: date.nullable().optional(),
});

export const recipeCatalogQuerySchema = z
  .object({
    query: z.string().trim().max(120).default(''),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    source: z.enum(['auto', 'local', 'remote']).default('auto'),
  })
  .refine((value) => value.source === 'local' || value.offset <= 900, {
    message: 'Недопустимая страница каталога.',
  });

export const adminRecipeTranslationSchema = z
  .object({
    mealTypes: mealTypes.optional(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/[а-яё]/i, 'Введите название на русском'),
    description: z.string().trim().max(10000).default(''),
    instructions: z.array(z.string().trim().min(1).max(4000)).max(100),
  })
  .strict();
export const adminProductTranslationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/[а-яё]/i, 'Введите название на русском'),
  })
  .strict();
export const adminCatalogQuerySchema = z.object({
  query: z.string().trim().max(120).default(''),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const adminSupportQuerySchema = z.object({
  filter: z.enum(['all', 'open', 'unanswered', 'closed']).default('all'),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
