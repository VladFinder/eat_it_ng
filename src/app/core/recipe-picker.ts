export type RecipePickMode = 'available' | 'almost';
export type RecipePickSource = 'all' | 'likes' | 'mine';

interface RecipeCandidate {
  id: string;
  mine: boolean;
  liked: boolean;
  usedIngredients?: string[];
  missedIngredients?: string[];
}

export function eligibleRecipes<T extends RecipeCandidate>(
  recipes: T[],
  mode: RecipePickMode,
  source: RecipePickSource,
  maximumMissing: number,
): T[] {
  return recipes.filter((recipe) => {
    const missing = recipe.missedIngredients?.length ?? 0;
    const total = missing + (recipe.usedIngredients?.length ?? 0);
    return (
      total > 0 &&
      (source !== 'mine' || recipe.mine) &&
      (source !== 'likes' || recipe.liked) &&
      (mode === 'available' ? missing === 0 : missing <= maximumMissing)
    );
  });
}

export function pickRecipe<T extends RecipeCandidate>(
  recipes: T[],
  previousId: string | null,
): T | null {
  const choices =
    recipes.length > 1 ? recipes.filter((recipe) => recipe.id !== previousId) : recipes;
  return choices.length ? choices[Math.floor(Math.random() * choices.length)] : null;
}
