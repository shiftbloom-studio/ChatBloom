// @refresh reload
import { mount, StartClient } from "@solidjs/start/client";

// biome-ignore lint/style/noNonNullAssertion: #app is always rendered by entry-server.tsx
mount(() => <StartClient />, document.getElementById("app")!);
