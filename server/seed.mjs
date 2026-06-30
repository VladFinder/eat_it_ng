import { prisma } from './db.mjs';

const fridgeCount = await prisma.fridgeItem.count();
const shoppingCount = await prisma.shoppingItem.count();
const household = await prisma.household.upsert({
  where: { id: 'legacy-household' },
  update: {},
  create: { id: 'legacy-household', name: 'Мой дом' },
});

if (fridgeCount === 0) {
  const today = new Date();
  const expiresAt = (days) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + days);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  };

  await prisma.fridgeItem.createMany({
    data: [
      {
        householdId: household.id,
        name: 'Яйца',
        quantity: 10,
        unit: 'шт',
        expiresAt: expiresAt(9),
      },
      {
        householdId: household.id,
        name: 'Молоко',
        quantity: 1,
        unit: 'л',
        expiresAt: expiresAt(2),
      },
      {
        householdId: household.id,
        name: 'Куриное филе',
        quantity: 700,
        unit: 'г',
        expiresAt: expiresAt(1),
      },
    ],
  });
}

if (shoppingCount === 0) {
  await prisma.shoppingItem.createMany({
    data: [
      { householdId: household.id, name: 'Овощи для салата', quantity: 1, unit: 'шт' },
      { householdId: household.id, name: 'Хлеб цельнозерновой', quantity: 1, unit: 'шт' },
    ],
  });
}

await prisma.$disconnect();
