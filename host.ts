import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contracts";
import { probeRepository } from "./git";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    probe: async ({ paths }, context) => {
      const results = [];
      for (const path of paths) results.push(await probeRepository(path, context.signal));
      return results;
    },
  },
});
