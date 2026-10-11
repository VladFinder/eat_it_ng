export const RECIPE_MEAL_TYPES = [
  { id: 'breakfast', label: 'Завтрак' },
  { id: 'lunch', label: 'Обед' },
  { id: 'dinner', label: 'Ужин' },
  { id: 'dessert', label: 'Десерт' },
  { id: 'soup', label: 'Суп' },
  { id: 'salad', label: 'Салат' },
  { id: 'side_dish', label: 'Гарнир' },
  { id: 'snack', label: 'Закуска / перекус' },
  { id: 'bread', label: 'Хлеб' },
  { id: 'drink', label: 'Напиток' },
  { id: 'sauce', label: 'Соус / маринад' },
] as const;

export type RecipeMealType = (typeof RECIPE_MEAL_TYPES)[number]['id'];
