export const recipeMealTypes = [
  'breakfast',
  'lunch',
  'dinner',
  'dessert',
  'soup',
  'salad',
  'side_dish',
  'snack',
  'bread',
  'drink',
  'sauce',
];

// Spoonacular can attach several overlapping types to the same recipe.
export function spoonacularMealTypes(dishTypes) {
  if (!Array.isArray(dishTypes)) return [];
  const mapping = {
    breakfast: ['breakfast'],
    brunch: ['breakfast'],
    'morning meal': ['breakfast'],
    lunch: ['lunch'],
    dinner: ['dinner'],
    'main course': ['lunch', 'dinner'],
    'main dish': ['lunch', 'dinner'],
    dessert: ['dessert'],
    soup: ['soup'],
    salad: ['salad'],
    'side dish': ['side_dish'],
    appetizer: ['snack'],
    snack: ['snack'],
    fingerfood: ['snack'],
    bread: ['bread'],
    beverage: ['drink'],
    drink: ['drink'],
    sauce: ['sauce'],
    marinade: ['sauce'],
  };
  return [
    ...new Set(
      dishTypes.flatMap((type) =>
        typeof type === 'string' && Object.hasOwn(mapping, type.trim().toLowerCase())
          ? mapping[type.trim().toLowerCase()]
          : [],
      ),
    ),
  ];
}
