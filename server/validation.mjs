import { z } from 'zod';

export const units = ['шт', 'г', 'кг', 'мл', 'л', 'упак', 'банка', 'бут'];

const name = z.string().trim().min(1).max(120);
const quantity = z.number().positive().max(1_000_000);
const unit = z.enum(units);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const fridgeCreateSchema = z.object({
  name,
  quantity,
  unit,
  expiresAt: date,
});

export const fridgeUpdateSchema = fridgeCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const consumeSchema = z.object({
  quantity,
});

export const shoppingCreateSchema = z.object({
  name,
  quantity: quantity.optional(),
  unit: unit.optional(),
});

export const shoppingUpdateSchema = z
  .object({
    name: name.optional(),
    quantity: quantity.nullable().optional(),
    unit: unit.nullable().optional(),
    checked: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const shoppingToFridgeSchema = z.object({
  quantity: quantity.optional(),
  unit: unit.optional(),
  expiresAt: date,
});
