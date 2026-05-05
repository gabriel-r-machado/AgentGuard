import { testAgent } from "agentguard";

testAgent("example: should include ok", {
  input: "Say ok",
  expected: {
    mustInclude: ["ok"],
  },
});
