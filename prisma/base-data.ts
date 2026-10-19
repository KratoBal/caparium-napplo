// The container start's basic data step (scripts/start.sh): runs at every start, WITHOUT a password,
// as the table owner. See src/lib/base-data.ts for what it loads and why.

import { PrismaClient } from "@prisma/client";
import { FEED_TYPES, GROUPS, loadBaseData, PARAMETERS, POOLS, UNITS } from "../src/lib/base-data";

const prisma = new PrismaClient();

loadBaseData(prisma)
  .then(() =>
    console.log(
      `base data ok: ${UNITS.length} units, ${PARAMETERS.length} parameters, ${POOLS.length} pools, ${GROUPS.length} groups, ${FEED_TYPES.length} feed types`,
    ),
  )
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
