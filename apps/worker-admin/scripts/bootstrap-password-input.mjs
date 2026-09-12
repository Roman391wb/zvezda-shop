import { StringDecoder } from "node:string_decoder";

function removeLastCodePoint(value) {
  return Array.from(value).slice(0, -1).join("");
}

function createCollector() {
  const decoder = new StringDecoder("utf8");
  let password = "";
  let status = "pending";

  const consume = (text) => {
    for (const character of text) {
      if (status !== "pending") break;
      if (character === "\u0003") status = "cancelled";
      else if (character === "\r" || character === "\n") status = "complete";
      else if (character === "\u007f") password = removeLastCodePoint(password);
      else password += character;
    }
  };

  return {
    push(chunk) {
      consume(decoder.write(chunk));
      return { status, password };
    },
    end() {
      consume(decoder.end());
      return { status, password };
    }
  };
}

/** Testable counterpart of the raw TTY reader; returns null if Enter was not received. */
export function passwordFromChunks(chunks) {
  const collector = createCollector();
  for (const chunk of chunks) {
    const result = collector.push(chunk);
    if (result.status !== "pending") return result.status === "complete" ? result.password : null;
  }
  const result = collector.end();
  return result.status === "complete" ? result.password : null;
}

export function readInteractivePassword(input, output) {
  return new Promise((resolve, reject) => {
    const collector = createCollector();
    const cleanup = () => {
      input.off("data", onData);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
    };
    const onData = (chunk) => {
      const result = collector.push(chunk);
      if (result.status === "pending") return;
      cleanup();
      if (result.status === "cancelled") reject(new Error("Cancelled"));
      else {
        output.write("\n");
        resolve(result.password);
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}
