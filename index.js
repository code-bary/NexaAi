import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

const PORT =
  process.env.PORT || 3000;

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);


/* JSON request support */

app.use(
  express.json({
    limit: "25mb"
  })
);


/* Static frontend files */

app.use(
  "/static",
  express.static(
    path.join(
      __dirname,
      "static"
    )
  )
);


/* Homepage */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "pages",
      "index.html"
    )
  );
});


/* =========================================================
   NVIDIA CHAT API
   ========================================================= */

app.post(
  "/api/chat",
  async (req, res) => {

    try {

      const {
        messages,
        model,
        temperature,
        top_p,
        max_tokens,
        stream
      } = req.body;


      /* Validate messages */

      if (
        !Array.isArray(messages)
      ) {

        return res.status(400).json({
          error: {
            message:
              "messages must be an array"
          }
        });

      }


      /* Check API key */

      if (
        !process.env.NVIDIA_API_KEY
      ) {

        console.error(
          "NVIDIA_API_KEY is missing"
        );

        return res.status(500).json({
          error: {
            message:
              "NVIDIA API key is not configured on the server."
          }
        });

      }


      /* NVIDIA request */

      const requestTimeoutMs = 180000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

      let nvidiaResponse;

      try {
        nvidiaResponse = await fetch(
          "https://integrate.api.nvidia.com/v1/chat/completions",
          {
            method: "POST",
            signal: controller.signal,

            headers: {
              "Content-Type":
                "application/json",

              "Authorization":
                `Bearer ${process.env.NVIDIA_API_KEY}`,

              "Accept":
                stream === false
                  ? "application/json"
                  : "text/event-stream"
            },

            body: JSON.stringify({
              model:
                model ||
                "nvidia/nemotron-3.5-lightning-30b-a3b",

              messages,

              temperature:
                temperature ?? 1,

              top_p:
                top_p ?? 0.95,

              max_tokens:
                max_tokens ?? 16384,

              stream:
                stream !== false
            })
          }
        );
      } catch (error) {
        clearTimeout(timeoutId);

        if (error?.name === "AbortError") {
          return res.status(504).json({
            error: {
              message: "NVIDIA request timed out while processing the image. Please try a smaller image or a simpler prompt."
            }
          });
        }

        throw error;
      } finally {
        clearTimeout(timeoutId);
      }


      /* NVIDIA error */

      if (
        !nvidiaResponse.ok
      ) {

        const errorText =
          await nvidiaResponse.text();

        console.error(
          "NVIDIA API Error:",
          nvidiaResponse.status,
          errorText
        );

        return res
          .status(
            nvidiaResponse.status
          )
          .send(errorText);

      }


      /* =====================================================
         NON-STREAM RESPONSE
         ===================================================== */

      if (
        stream === false
      ) {

        const data =
          await nvidiaResponse.json();

        return res.json(data);

      }


      /* =====================================================
         STREAM RESPONSE
         ===================================================== */

      res.status(200);

      res.setHeader(
        "Content-Type",
        "text/event-stream"
      );

      res.setHeader(
        "Cache-Control",
        "no-cache, no-transform"
      );

      res.setHeader(
        "Connection",
        "keep-alive"
      );

      res.setHeader(
        "X-Accel-Buffering",
        "no"
      );


      if (
        typeof res.flushHeaders ===
        "function"
      ) {
        res.flushHeaders();
      }


      if (
        !nvidiaResponse.body
      ) {

        return res.end();

      }


      const reader =
        nvidiaResponse.body.getReader();


      try {

        while (true) {

          const {
            value,
            done
          } =
            await reader.read();


          if (done) {
            break;
          }


          res.write(
            Buffer.from(value)
          );

        }

      } finally {

        reader.releaseLock();

      }


      res.end();

    } catch (error) {
      console.error("Backend error:", error);
      console.error("Cause:", error?.cause);

      if (!res.headersSent) {
        res.status(500).json({
          error: {
            message: error?.message || "Internal server error"
          }
        });
      } else {
        res.end();
      }
    }

  }
);


/* =========================================================
   SERVER
   ========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `NexaAI server running on port ${PORT}`
    );

  }
);