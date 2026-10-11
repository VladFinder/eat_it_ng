import { describe, expect, it, vi } from 'vitest';
import { eligibleRecipes, pickRecipe } from './recipe-picker';

const recipes = [
  { id: 'ready', mine: false, liked: true, usedIngredients: ['Яйца'], missedIngredients: [] },
  { id: 'one', mine: true, liked: false, usedIngredients: ['Яйца'], missedIngredients: ['Сыр'] },
  {
    id: 'two',
    mine: true,
    liked: true,
    usedIngredients: [],
    missedIngredients: ['Мука', 'Молоко'],
  },
  {
    id: 'three',
    mine: false,
    liked: false,
    usedIngredients: [],
    missedIngredients: ['А', 'Б', 'В'],
  },
  { id: 'unknown', mine: true, liked: true },
];

describe('recipe picker', () => {
  it('can buy every ingredient even with an empty fridge, keeping source and type filters', () => {
    const dishes = [
      {
        id: 'dessert',
        mine: true,
        liked: true,
        mealTypes: ['dessert'] as const,
        usedIngredients: [],
        missedIngredients: ['А', 'Б', 'В', 'Г', 'Д'],
      },
    ].map((dish) => ({ ...dish, mealTypes: [...dish.mealTypes] }));
    expect(eligibleRecipes(dishes, 'almost', 'all', 3)).toEqual([]);
    expect(eligibleRecipes(dishes, 'available', 'all', 3)).toEqual([]);
    expect(eligibleRecipes(dishes, 'any', 'likes', 0, 'dessert')).toEqual(dishes);
    expect(eligibleRecipes(dishes, 'any', 'mine', 0, 'breakfast')).toEqual([]);
    expect(eligibleRecipes([recipes[4]], 'any', 'all', 0)).toEqual([]);
  });

  it('supports overlapping lunch and dinner categories and excludes unknown types only when filtering', () => {
    const dishes = [
      { ...recipes[0], mealTypes: ['lunch', 'dinner'] as ('lunch' | 'dinner')[] },
      { ...recipes[1] },
    ];
    expect(eligibleRecipes(dishes, 'any', 'all', 0, 'lunch').map((r) => r.id)).toEqual(['ready']);
    expect(eligibleRecipes(dishes, 'any', 'all', 0, 'dinner').map((r) => r.id)).toEqual(['ready']);
    expect(eligibleRecipes(dishes, 'any', 'all', 0, 'breakfast')).toEqual([]);
    expect(eligibleRecipes(dishes, 'any', 'all', 0, 'all')).toHaveLength(2);
  });
  it('requires known ingredients and honors the exact missing ingredient limit', () => {
    expect(eligibleRecipes(recipes, 'available', 'all', 3).map((r) => r.id)).toEqual(['ready']);
    for (const limit of [1, 2, 3]) {
      expect(eligibleRecipes(recipes, 'almost', 'all', limit).length).toBe(limit + 1);
    }
  });

  it('combines ingredient conditions with favorites and household sources', () => {
    expect(eligibleRecipes(recipes, 'almost', 'likes', 2).map((r) => r.id)).toEqual([
      'ready',
      'two',
    ]);
    expect(eligibleRecipes(recipes, 'almost', 'mine', 1).map((r) => r.id)).toEqual(['one']);
    expect(eligibleRecipes(recipes, 'available', 'mine', 2)).toEqual([]);
  });

  it('avoids an immediate repeat when alternatives exist and handles a single or empty set', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      expect(pickRecipe(recipes.slice(0, 2), 'ready')?.id).toBe('one');
      expect(pickRecipe(recipes.slice(0, 1), 'ready')?.id).toBe('ready');
      expect(pickRecipe([], 'ready')).toBeNull();
      random.mockReturnValue(0.999);
      expect(pickRecipe(recipes.slice(0, 2), null)?.id).toBe('one');
    } finally {
      random.mockRestore();
    }
  });
});
