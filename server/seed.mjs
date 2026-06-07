import { prisma } from './db.mjs';

const fridgeCount = await prisma.fridgeItem.count();
const shoppingCount = await prisma.shoppingItem.count();

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
      { name: 'Яйца', quantity: 10, unit: 'шт', expiresAt: expiresAt(9) },
      { name: 'Молоко', quantity: 1, unit: 'л', expiresAt: expiresAt(2) },
      { name: 'Куриное филе', quantity: 700, unit: 'г', expiresAt: expiresAt(1) },
    ],
  });
}

if (shoppingCount === 0) {
  await prisma.shoppingItem.createMany({
    data: [{ name: 'Овощи для салата' }, { name: 'Хлеб цельнозерновой' }],
  });
}

await prisma.$disconnect();
