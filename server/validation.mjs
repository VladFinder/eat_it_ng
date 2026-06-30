import { z } from 'zod';

export const units = ['шт', 'г', 'кг', 'мл', 'л', 'упак', 'банка', 'бут'];
export const categories = ['products', 'household'];

const name = z.string().trim().min(1).max(120);
const quantity = z.number().positive().max(1_000_000);
const unit = z.enum(units);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reminderDays = z.number().int().min(0).max(365);
const category = z.enum(categories);
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const password = z.string().min(8).max(128);

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

const fridgeFields = {
  name,
  quantity,
  unit,
  expiresAt: date,
  reminderDays,
  category,
};

export const fridgeCreateSchema = z.object({
  ...fridgeFields,
  reminderDays: reminderDays.default(1),
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
  unit: unit.default('шт'),
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
  expiresAt: date,
  reminderDays: reminderDays.optional(),
  category: category.optional(),
});
