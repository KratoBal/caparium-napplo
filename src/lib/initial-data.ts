// THE STARTING LISTS of the customer's description (task caparium-hibak-1, Balázs 2026-10-20): the animals
// by pool (leírás 18. o., "Adatok a medencékhez, állatokhoz és takarmányhoz", DN-04) and the feeds by type
// (leírás 19. o., T-13). Loaded with the basic data at every start, the animals only on the test system
// (src/lib/seed-switch.ts: a live system's admin records them with their real arrival): an animal, a group
// or a feed is created only where no row has ever carried its name, so an admin's rename, death, release or
// deactivation stays.
//
// Letter by letter from the description, with two kinds of reading and nothing else:
// - "Elkülönítő" is the pool KARANTEN (DN-01); "♂", "1.0" (zoo notation: one male) and the names "Hím" /
//   "Nőstény" give the sex, everything else is UNKNOWN.
// - the rows without a species ("Inkubátor - korallok", "Korallos – halak", "Korallos – korallok") and
//   "Rajhalak" are one feeding unit each; their species field is the description's own word for them.
// The spellings stay as written ("Giglymostoma", "amblyrynchos", "Dicentrarchus labra"): the admin
// corrects them (DN-04, T-04 "helyesbítés"); the differences between the sources are D-05 and D-06.
// The units: the feed template's second row (all "g", Litopenaeus vannamei "db" and "g", DN-16); the
// description gives none for the small and liquid feeds, so the frozen ones are grams and the two
// liquid coral feeds millilitres.

import type { Dimension, PrismaClient, Sex } from "@prisma/client";
import { rebuildAnimal } from "./animals";
import { SYSTEM_USER_ID } from "./db";
import { businessDayOf, dayToDate } from "./time";

type InitialAnimal = { pool: string; species: string; name: string; sex: Sex; group?: string };

export const INITIAL_ANIMALS: InitialAnimal[] = [
  { pool: "NAGY", species: "Stegostoma tigrinum", name: "Philleas", sex: "UNKNOWN" },
  { pool: "NAGY", species: "Giglymostoma cirratum", name: "Nokedli", sex: "MALE" },
  { pool: "NAGY", species: "Giglymostoma cirratum", name: "Gnocchi", sex: "MALE" },
  { pool: "NAGY", species: "Giglymostoma cirratum", name: "Margit", sex: "UNKNOWN" },
  { pool: "NAGY", species: "Giglymostoma cirratum", name: "Nudli", sex: "UNKNOWN" },
  { pool: "NAGY", species: "Nebrius ferrugineus", name: "Bömbi", sex: "UNKNOWN" },
  { pool: "NAGY", species: "Nebrius ferrugineus", name: "Döme", sex: "UNKNOWN" },
  { pool: "NAGY", species: "Carcharhinus amblyrynchos", name: "Tango", sex: "UNKNOWN" },
  { pool: "NAGY", species: "Glaucostegus typus", name: "Hím", sex: "MALE" },
  { pool: "NAGY", species: "Glaucostegus cemiculus", name: "Nőstény", sex: "FEMALE" },
  { pool: "NAGY", species: "Epinephelus lanceolatus", name: "Lancelot", sex: "UNKNOWN" },
  { pool: "NAGY", species: "Rajhalak", name: "Rajhalak", sex: "UNKNOWN" },
  { pool: "KARANTEN", species: "Rhinoptera bonasus", name: "SeaFlap", sex: "MALE", group: "Ráják" },
  { pool: "KARANTEN", species: "Rhinoptera bonasus", name: "Flap", sex: "MALE", group: "Ráják" },
  { pool: "KARANTEN", species: "Pseudoginglymostoma brevicaudatum", name: "Mamusz", sex: "UNKNOWN", group: "RFD" },
  { pool: "KARANTEN", species: "Pseudoginglymostoma brevicaudatum", name: "Pogácsa", sex: "UNKNOWN", group: "RFD" },
  { pool: "KARANTEN", species: "Hemiscyllium ocellatum", name: "Szemfoltos", sex: "UNKNOWN" },
  { pool: "RAGADOZOS", species: "Pterois volitans", name: "Tűzhal", sex: "UNKNOWN" },
  { pool: "RAGADOZOS", species: "Antennarius pictus", name: "Horgászhal", sex: "UNKNOWN" },
  { pool: "RAGADOZOS", species: "Gymnomuraena zebra", name: "Zebra muréna", sex: "UNKNOWN", group: "Murénák" },
  { pool: "RAGADOZOS", species: "Echidna nebulosa", name: "Hópehely", sex: "UNKNOWN", group: "Murénák" },
  { pool: "RAGADOZOS", species: "Echidna polyzona", name: "Soköves", sex: "UNKNOWN", group: "Murénák" },
  { pool: "INKUBATOR", species: "Inkubátor - korallok", name: "Inkubátor - korallok", sex: "UNKNOWN" },
  { pool: "KORALLOS", species: "Korallos – halak", name: "Korallos – halak", sex: "UNKNOWN" },
  { pool: "KORALLOS", species: "Korallos – korallok", name: "Korallos – korallok", sex: "UNKNOWN" },
];

type InitialFeed = { type: string; name: string; dims: Dimension[]; unit: string };
const mass = (type: string, name: string): InitialFeed => ({ type, name, dims: ["MASS"], unit: "g" });

export const INITIAL_FEEDS: InitialFeed[] = [
  mass("KAGYLO", "Mytilus sp."),
  mass("KAGYLO", "Meretrix lyrata"),
  mass("KAGYLO", "Pecten jacobaeus"),
  mass("RAK", "Pandalus borealis"),
  mass("RAK", "Metapenaeus monoceros"),
  { type: "RAK", name: "Litopenaeus vannamei", dims: ["MASS", "COUNT"], unit: "g" },
  mass("LABASFEJU", "Loligo sp."),
  mass("LABASFEJU", "Octopus sp."),
  mass("HAL", "Scomber scombrus"),
  mass("HAL", "Salmo salar"),
  mass("HAL", "Mallotus villosus"),
  mass("HAL", "M.aeglefinus & M.merlucius"),
  mass("HAL", "Clupea harengus"),
  mass("HAL", "Dicentrarchus labra"),
  mass("APRO", "Artemia"),
  mass("APRO", "Mysis"),
  mass("APRO", "Krill"),
  mass("APRO", "Homárikra"),
  { type: "APRO", name: "RE+ Coral nutrition AB+", dims: ["VOLUME"], unit: "ml" },
  { type: "APRO", name: "AF Power elixir", dims: ["VOLUME"], unit: "ml" },
];

/**
 * The test system's mark IN ITS DATA (caparium-hibak-2, acrobot 33337): the arrival the seed's synthetic data made
 * (prisma/seed.ts, requestId "seed-arrival-1"). The stage has it: its synthetic animals came from the seed before
 * the switch existed (#16), and the 20261020080100 migration found and released them there; its environment has
 * no CAPARIUM_SEED_SZINTETIKUS, so the switch alone loaded nothing (measured on 588fe93). A live system never has
 * synthetic data, so the mark is never there.
 */
export async function hasTestSystemData(prisma: PrismaClient): Promise<boolean> {
  return (await prisma.lifecycleEvent.findUnique({ where: { requestId: "seed-arrival-1" }, select: { id: true } })) !== null;
}

/** The feeds of the list no feed name has ever carried, after the sort orders already used. */
export async function loadInitialFeeds(prisma: PrismaClient, unitId: Map<string, string>, since: Date): Promise<void> {
  const have = new Set((await prisma.feedName.findMany()).map((n) => n.name));
  let sortOrder = (await prisma.feed.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
  for (const f of INITIAL_FEEDS) {
    if (have.has(f.name)) continue;
    const type = await prisma.feedType.findUniqueOrThrow({ where: { code: f.type } });
    sortOrder += 1;
    await prisma.feed.create({
      data: {
        typeId: type.id,
        allowedDimensions: f.dims,
        defaultUnitId: unitId.get(f.unit)!,
        sortOrder,
        names: { create: { name: f.name, validFrom: since } },
      },
    });
  }
}

/**
 * The animals of the list no animal name has ever carried: each arrives in its pool (and group) at
 * `since`, by the System user, and its placement is derived the way every lifecycle change derives it.
 */
export async function loadInitialAnimals(prisma: PrismaClient, poolId: Map<string, string>, since: Date): Promise<void> {
  const have = new Set((await prisma.animalName.findMany({ select: { name: true } })).map((n) => n.name));
  const missing = INITIAL_ANIMALS.filter((a) => !have.has(a.name));
  if (missing.length === 0) return;
  const businessDay = dayToDate(businessDayOf(since));
  for (const a of missing) {
    await prisma.$transaction(async (tx) => {
      const species =
        (await tx.species.findFirst({ where: { scientificName: a.species } })) ??
        (await tx.species.create({ data: { scientificName: a.species } }));
      let groupId: string | null = null;
      if (a.group) {
        const named = await tx.animalGroupName.findFirst({ where: { name: a.group } });
        groupId = named?.groupId ?? (await tx.animalGroup.create({ data: { names: { create: { name: a.group, validFrom: since } } } })).id;
      }
      const animal = await tx.animal.create({
        data: { speciesId: species.id, sex: a.sex, names: { create: { name: a.name, validFrom: since } } },
      });
      await tx.lifecycleEvent.create({
        data: {
          animalId: animal.id,
          type: "ARRIVAL",
          occurredAt: since,
          businessDay,
          toPoolId: poolId.get(a.pool)!,
          toGroupId: groupId,
          note: "Kezdő állatlista (leírás 18. o.)",
          requestId: `alapadat-erkezes-${animal.id}`,
          createdById: SYSTEM_USER_ID,
          updatedById: SYSTEM_USER_ID,
        },
      });
      await rebuildAnimal(tx, animal.id);
    });
  }
}
