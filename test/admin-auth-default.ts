import { vi } from "vitest";
import { testAdminAuth } from "./auth-fixtures";

/**
 * Points the app's Admin Auth seam at the registry-backed fake for every feature test. Files that mock
 * `src/lib/firebase/admin` themselves override this, as before. Other exports keep their real implementation.
 */
vi.mock("../src/lib/firebase/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/firebase/admin")>()),
  // The fake implements only the members feature tests use; the cast is confined to this test seam.
  getAdminAuth: () => testAdminAuth as unknown as ReturnType<typeof import("../src/lib/firebase/admin").getAdminAuth>,
}));
