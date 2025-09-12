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

export interface StudioOptions {
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
  statement: string
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
      }, {} as Record<string, unknown>)
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
  options?: StudioOptions
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

function createImportInterface() {
  return `<!DOCTYPE html>
<html>
<head>
    <title>JSON Import</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        input, button { width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box; }
        button { background: #007cba; color: white; border: none; cursor: pointer; }
        button:disabled { background: #ccc; }
        .status { margin: 20px 0; padding: 10px; border-radius: 4px; }
        .success { background: #d4edda; color: #155724; }
        .error { background: #f8d7da; color: #721c24; }
        .info { background: #d1ecf1; color: #0c5460; }
    </style>
</head>
<body>
    <h1>Import JSON</h1>
    <p>Upload JSON array of objects:</p>
    <input type="text" id="tableName" placeholder="Table name" />
    <input type="file" id="jsonFile" accept=".json" />
    <button onclick="importJSON()">Import</button>
    <div id="status"></div>

    <script>
        function escape(val) {
            return val === null || val === undefined ? 'NULL' : 
                   typeof val === 'string' ? "'" + val.replace(/'/g, "''") + "'" : 
                   val.toString();
        }
        
        async function importJSON() {
            const table = document.getElementById('tableName').value.trim();
            const file = document.getElementById('jsonFile').files[0];
            
            if (!table || !file) {
                show('Enter table name and select file', 'error');
                return;
            }
            
            document.querySelector('button').disabled = true;
            show('Processing...', 'info');
            
            try {
                const data = JSON.parse(await file.text());
                if (!Array.isArray(data) || data.length === 0) {
                    throw new Error('JSON must be non-empty array');
                }
                
                let success = 0, errors = 0;
                
                for (let i = 0; i < data.length; i++) {
                    try {
                        const obj = data[i];
                        const cols = Object.keys(obj);
                        const vals = cols.map(c => escape(obj[c]));
                        const sql = \`INSERT OR REPLACE INTO \${table} (\${cols.join(',')}) VALUES (\${vals.join(',')});\`;
                        
                        const res = await fetch(location.pathname, {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({type: 'query', id: Date.now() + '_' + i, statement: sql})
                        });
                        
                        const result = await res.json();
                        if (result.error) throw new Error(result.error);
                        success++;
                    } catch (e) {
                        errors++;
                    }
                }
                
                show(\`Done: \${success} success, \${errors} errors\`, success > 0 ? 'success' : 'error');
                
            } catch (e) {
                show('Error: ' + e.message, 'error');
            } finally {
                document.querySelector('button').disabled = false;
            }
        }
        
        function show(msg, type) {
            const div = document.getElementById('status');
            div.className = 'status ' + type;
            div.textContent = msg;
        }
    </script>
</body>
</html>`;
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
  options?: StudioOptions
) {
  // Check authentication
  const authResponse = requireAuth(request, options);
  if (authResponse) {
    return authResponse;
  }
  const url = new URL(request.url);

  if (request.method === "GET") {
    if (url.searchParams.get("page") === "import") {
      return new Response(createImportInterface(), {
        headers: { "Content-Type": "text/html" },
      });
    }
    return new Response(createStudioInterface(), {
      headers: { "Content-Type": "text/html" },
    });
  } else if (request.method === "POST") {
    const body = (await request.json()) as StudioRequest;

    if (body.type === "query") {
      try {
        const result = await executeQueryWithRaw(
          rawRpcFunction,
          body.statement
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
