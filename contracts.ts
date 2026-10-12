import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const repositorySchema = z.object({
  id: z.string(), hostId: z.string(), label: z.string(), path: z.string(),
  origin: z.string().optional(),
}).strict();
const ids = z.array(z.string().min(1)).max(200);
const path = z.string().min(1).max(4096);
export const probeSchema = z.object({
  path: z.string(), root: z.string().nullable(), commonDir: z.string().nullable(), error: z.string().nullable(),
  origin: z.string().optional(),
}).strict();
export const hostContract = defineRpcContract({
  probe: { input: z.object({ paths: z.array(path).max(200) }).strict(), output: z.array(probeSchema) },
});
export const stateSchema = z.object({
  environments: z.array(z.object({ environmentId: z.string(), repository: repositorySchema.nullable(), error: z.string().nullable() })),
  assignments: z.array(z.object({ threadId: z.string(), repository: repositorySchema })),
});
export type RepositoryState = z.infer<typeof stateSchema>;
export const rpcContract = defineRpcContract({
  state: {
    input: z.object({ threadIds: ids, environmentIds: ids, refresh: z.boolean().optional() }).strict(),
    output: stateSchema,
  },
  assign: {
    input: z.object({ threadId: z.string().min(1), path: path.nullable() }).strict(),
    output: repositorySchema.nullable(),
  },
});
