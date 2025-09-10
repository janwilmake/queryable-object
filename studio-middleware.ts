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
    <a href="?page=import">Import SQL</a>
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
    <title>SQL Import</title>
</head>
<body>
    <h2>Import SQL File</h2>
    <input type="file" id="sqlFile" accept=".sql" />
    <button onclick="importSQL()" id="importBtn">Import</button>
    <div id="status"></div>
    <div id="results"></div>

    <script type="module">
        import * as sqlParser from 'https://unpkg.com/sql-parser-cst@latest/lib/main.js';
        
        window.sqlParser = sqlParser;
        
        function parseSqlStatements(sql) {
            try {
                const ast = sqlParser.parse(sql, { 
                    dialect: 'sqlite',
                    includeSpaces: true,
                    includeComments: true 
                });
                
                const statements = [];
                
                if (ast.statements) {
                    ast.statements.forEach((stmt, index) => {
                        if (stmt && stmt.type !== 'empty') {
                            const statementSql = sqlParser.show(stmt);
                            
                            if (statementSql.trim()) {
                                statements.push(statementSql.trim());
                            }
                        }
                    });
                }
                
                return statements;
            } catch (error) {
                console.error('Failed to parse SQL:', error);
                return [];
            }
        }
        
        window.parseSqlStatements = parseSqlStatements;
    </script>

    <script>
        async function importSQL() {
            const fileInput = document.getElementById('sqlFile');
            const file = fileInput.files[0];
            
            if (!file) {
                alert('Please select a SQL file');
                return;
            }
            
            const importBtn = document.getElementById('importBtn');
            const status = document.getElementById('status');
            const results = document.getElementById('results');
            
            importBtn.disabled = true;
            status.innerHTML = 'Reading file...';
            results.innerHTML = '';
            
            try {
                const sqlContent = await file.text();
                status.innerHTML = 'Parsing SQL...';
                
                const statements = window.parseSqlStatements(sqlContent);
                
                if (statements.length === 0) {
                    status.innerHTML = 'No valid SQL statements found';
                    importBtn.disabled = false;
                    return;
                }
                
                status.innerHTML = \`Found \${statements.length} statements. Executing...\`;
                
                let successCount = 0;
                let failCount = 0;
                
                for (let i = 0; i < statements.length; i++) {
                    const statement = statements[i];
                    
                    try {
                        const response = await fetch(window.location.pathname, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                type: 'query',
                                id: \`import_\${i}_\${Date.now()}\`,
                                statement: statement
                            })
                        });
                        
                        const result = await response.json();
                        
                        if (result.error) {
                            throw new Error(result.error);
                        }
                        
                        successCount++;
                        
                    } catch (error) {
                        failCount++;
                        console.error(\`Statement \${i + 1} failed:\`, error);
                        
                        const errorDiv = document.createElement('div');
                        errorDiv.innerHTML = \`<strong>Statement \${i + 1} failed:</strong> \${error.message}<br><pre>\${statement}</pre><hr>\`;
                        results.appendChild(errorDiv);
                    }
                    
                    // Update progress
                    status.innerHTML = \`Progress: \${i + 1}/\${statements.length} (\${successCount} succeeded, \${failCount} failed)\`;
                }
                
                status.innerHTML = \`Import complete! \${successCount} statements succeeded, \${failCount} failed.\`;
                
            } catch (error) {
                status.innerHTML = \`Error: \${error.message}\`;
                console.error(error);
            }
            
            importBtn.disabled = false;
        }
        
        window.importSQL = importSQL;
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
