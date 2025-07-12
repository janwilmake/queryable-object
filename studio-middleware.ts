interface StudioQueryRequest {
  type: "query";
  id: string;
  statement: string;
}

interface StudioTransactionRequest {
  type: "transaction";
  id: string;
  statements: string[];
}

type StudioRequest = StudioQueryRequest | StudioTransactionRequest;

interface StudioOptions {
  dangerouslyDisableAuth?: boolean;
  basicAuth?: {
    username: string;
    password: string;
  };
}

function createStudioInterface() {
  return `<!DOCTYPE html>
<html>
<head>
    <style>
        html,
        body {
            padding: 0;
            margin: 0;
            width: 100vw;
            height: 100vh;
        }

        iframe {
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            border: 0;
        }
    </style>
    <title>Your Starbase - Outerbase Studio</title>
    <link
        rel="icon"
        type="image/x-icon"
        href="https://studio.outerbase.com/icons/outerbase.ico"
    />
</head>
<body>
    <script>
        function handler(e) {
            if (e.data.type !== "query" && e.data.type !== "transaction") return;

            fetch(window.location.pathname, {
                method: "post",
                body: JSON.stringify(e.data),
            })
                .then((r) => {
                    if (!r.ok) {
                        document.getElementById("editor").contentWindow.postMessage(
                            {
                                id: e.data.id,
                                type: e.data.type,
                                error: "Something went wrong",
                            },
                            "*"
                        );
                        throw new Error("Something went wrong");
                    }
                    return r.json();
                })
                .then((r) => {
                    if (r.error) {
                        document.getElementById("editor").contentWindow.postMessage(
                            {
                                id: e.data.id,
                                type: e.data.type,
                                error: r.error,
                            },
                            "*"
                        )
                    }

                    const response = {
                        id: e.data.id,
                        type: e.data.type,
                        data: r.result
                    };

                    document
                        .getElementById("editor")
                        .contentWindow.postMessage(response, "*");
                })
                .catch(console.error);
        }

        window.addEventListener("message", handler);
    </script>

    <iframe
        id="editor"
        allow="clipboard-read; clipboard-write"
        src="https://studio.outerbase.com/embed/starbase"
    ></iframe>
</body>
</html>`;
}

async function executeQueryWithRaw(
  rawRpcFunction: (query: string, ...bindings: any[]) => Promise<any>,
  statement: string,
) {
  const startTime = performance.now();
  const result = await rawRpcFunction(statement);
  const endTime = performance.now();
  const queryDurationMs = Math.round((endTime - startTime) * 100) / 100; // Round to 2 decimal places

  // Handle the column name mapping carefully
  const columnSet = new Set();
  const columnNames = result.columnNames.map((colName: string) => {
    let renameColName = colName;

    for (let i = 0; i < 20; i++) {
      if (!columnSet.has(renameColName)) break;
      renameColName = "__" + colName + "_" + i;
    }

    columnSet.add(renameColName);

    return {
      name: renameColName,
      displayName: colName,
      originalType: "text",
      type: undefined,
    };
  });

  return {
    headers: columnNames,
    rows: result.raw.map((row: any[]) =>
      columnNames.reduce((obj, col, idx) => {
        obj[col.name] = row[idx];
        return obj;
      }, {} as Record<string, unknown>),
    ),
    stat: {
      queryDurationMs,
      rowsAffected: result.rowsWritten || 0,
      rowsRead: result.rowsRead || 0,
      rowsWritten: result.rowsWritten || 0,
    },
  };
}

function requireAuth(
  request: Request,
  options?: StudioOptions,
): Response | null {
  // If auth is dangerously disabled, skip all auth checks
  if (options?.dangerouslyDisableAuth) {
    return null;
  }

  // If no basicAuth config is provided, require auth by default
  if (!options?.basicAuth) {
    return new Response("Authentication required - no credentials configured", {
      status: 401,
    });
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return new Response("Authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Secure Area"',
      },
    });
  }

  const encoded = authHeader.split(" ")[1];
  const decoded = atob(encoded);
  const [username, password] = decoded.split(":");

  if (
    username !== options.basicAuth.username ||
    password !== options.basicAuth.password
  ) {
    return new Response("Invalid credentials", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Secure Area"',
      },
    });
  }

  return null;
}

export async function studioMiddleware(
  request: Request,
  rawRpcFunction: (
    query: string,
    ...bindings: any[]
  ) => Promise<{
    raw: any[][];
    columnNames: string[];
    rowsRead: number;
    rowsWritten: number;
  }>,
  options?: StudioOptions,
) {
  // Check authentication
  const authResponse = requireAuth(request, options);
  if (authResponse) {
    return authResponse;
  }

  if (request.method === "GET") {
    return new Response(createStudioInterface(), {
      headers: { "Content-Type": "text/html" },
    });
  } else if (request.method === "POST") {
    const body = (await request.json()) as StudioRequest;

    if (body.type === "query") {
      try {
        const result = await executeQueryWithRaw(
          rawRpcFunction,
          body.statement,
        );
        return Response.json({ result });
      } catch (e) {
        if (e instanceof Error) {
          return Response.json({ error: e.message });
        }
        return Response.json({ error: "Unknown error" });
      }
    } else if (body.type === "transaction") {
      try {
        const results = [];
        for (const statement of body.statements) {
          const result = await executeQueryWithRaw(rawRpcFunction, statement);
          results.push(result);
        }
        return Response.json({ result: results });
      } catch (e) {
        if (e instanceof Error) {
          return Response.json({ error: e.message });
        }
        return Response.json({ error: "Unknown error" });
      }
    }

    return Response.json({ error: "Invalid request" });
  }

  return new Response("Method not allowed", { status: 405 });
}
