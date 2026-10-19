import { z } from "zod";
import { renameEntity, renameSchema } from "@/lib/animals";
import { handle, parseJson } from "@/lib/api";

const schema = renameSchema.extend({ kind: z.enum(["animal", "group"]), id: z.uuid() });

export async function POST(req: Request) {
  return handle(req, async (user) => {
    const { kind, id, ...rest } = await parseJson(req, schema);
    return renameEntity(user, kind, id, rest);
  });
}
