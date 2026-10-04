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
