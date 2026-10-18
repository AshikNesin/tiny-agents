import { prisma } from "@groot/core/database/client";
import bcrypt from "bcryptjs";

export const SEED_USER = {
  email: "demo@example.com",
  password: "demo@example.com",
  name: "Demo User",
};

async function main() {
  const existingUser = await prisma.user.findUnique({
    where: { email: SEED_USER.email },
  });

  if (existingUser) {
    console.log("   Seed user already exists");
  } else {
    const hashedPassword = await bcrypt.hash(SEED_USER.password, 10);
    await prisma.user.upsert({
      where: { email: SEED_USER.email },
      update: {},
      create: {
        email: SEED_USER.email,
        name: SEED_USER.name,
        password: hashedPassword,
      },
    });
    console.log("   ✅ Seed user created");
  }

  console.log(`   📧 Email:    ${SEED_USER.email}`);
  console.log(`   🔑 Password: ${SEED_USER.password}`);

  console.log("   📝 Task list starts empty (tasks replace demo todos)");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
