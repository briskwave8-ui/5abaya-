import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { createServer } from "http";
import { Server } from "socket.io";
import { runAmazonScraper } from "./src/lib/scraper.ts";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  const PORT = 3000;

  app.use(express.json());

  // Socket.io connection
  io.on("connection", (socket) => {
    console.log("Client connected to socket");
    socket.emit("log", { message: "Connected to real-time log stream.", type: "info" });
  });

  // API Route to trigger scraping (Asynchronous)
  app.post("/api/scrape", async (req, res) => {
    const { keyword, deviceType, mode } = req.body;
    
    // Start scraping in background
    (async () => {
      try {
        io.emit("log", { message: `Starting extraction for: ${keyword || "Default URL"} (${deviceType || "desktop"} mode, ${mode || "standard"} strategy)`, type: "info" });
        
        const data = await runAmazonScraper(
          (msg, type) => {
            io.emit("log", { message: msg, type: type || "info" });
          },
          (partialProduct) => {
            io.emit("scrape:partial", partialProduct);
          },
          keyword,
          deviceType,
          mode
        );

        fs.writeFileSync("amazon_extracted_data.json", JSON.stringify(data, null, 2));
        io.emit("scrape:complete", { data, count: data.length });
        io.emit("log", { message: "Extraction completed successfully.", type: "success" });
      } catch (error: any) {
        console.error("Scraping failed:", error);
        io.emit("log", { message: `CRITICAL ERROR: ${error.message}`, type: "error" });
        io.emit("scrape:error", { error: error.message });
      }
    })();

    // Return immediately to prevent timeout
    res.json({ success: true, message: "Scraping started" });
  });

  // API Route to get existing data
  app.get("/api/data", (req, res) => {
    const filePath = path.join(process.cwd(), "amazon_extracted_data.json");
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      res.json(data);
    } else {
      res.json([]);
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => res.sendFile(path.resolve("dist/index.html")));
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
