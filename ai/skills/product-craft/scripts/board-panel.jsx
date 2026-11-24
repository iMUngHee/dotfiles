// Browser side of the candidate board: renders the agent's A2UI surface and posts the
// owner's action back to board.mjs. Bundled by board.mjs serve with esbuild.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageProcessor } from "@a2ui/web_core";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import { A2uiSurface } from "@a2ui/react";

const SURFACE_ID = "candidate-feedback";
const { token } = window.BOARD;
const status = value => [{ version: "1.0", updateDataModel: { surfaceId: SURFACE_ID, path: "/status", value } }];

const processor = new MessageProcessor([basicCatalog], async action => {
  try {
    const response = await fetch("/__action", {
      method: "POST",
      headers: { "content-type": "application/json", "x-board-token": token },
      body: JSON.stringify(action),
    });
    const isJson = (response.headers.get("content-type") ?? "").startsWith("application/json");
    processor.processMessages(isJson ? await response.json() : status(await response.text()));
  } catch {
    processor.processMessages(status("보드가 닫혔습니다. 대화창에서 답해 주세요."));
  }
});

function Panel() {
  const [surface, setSurface] = useState();
  useEffect(() => {
    fetch("/__surface.json")
      .then(response => response.json())
      .then(messages => {
        processor.processMessages(messages);
        const model = processor.model.surfacesMap.get(SURFACE_ID);
        // Picking a number shows that candidate, so a comment is never written while looking at another.
        model.dataModel.subscribe("/feedback/choice", value => {
          const number = Number(value?.[0]);
          const viewer = document.querySelector("iframe").contentDocument;
          viewer.querySelectorAll("nav button")[number - 1]?.click();
        });
        setSurface(model);
        document.getElementById("loading").remove();
      });
  }, []);
  return surface ? <A2uiSurface surface={surface} /> : null;
}

createRoot(document.getElementById("panel")).render(<Panel />);
