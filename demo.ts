import { DurableObject } from "cloudflare:workers";
import { Queryable, QueryableHandler, studioMiddleware } from "./queryable";

type Env = { MyDO: DurableObjectNamespace<MyDO & QueryableHandler> };

@Queryable()
export class MyDO extends DurableObject {
  sql: SqlStorage;
  env: any;
  // raw: Raw;
  // exec: Exec;
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.env = env;
    this.sql = state.storage.sql;
    // this.raw = new QueryableHandler(this.sql).raw;
    // this.exec = new QueryableHandler(this.sql).exec;
    // Create items table if it doesn't exist
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        category TEXT NOT NULL,
        in_stock BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Check if table is empty and seed with sample data
    const count = this.sql.exec("SELECT COUNT(*) as count FROM items").one();
    if (count.count === 0) {
      const sampleItems = [
        {
          name: "Wireless Headphones",
          description:
            "High-quality Bluetooth headphones with noise cancellation",
          price: 199.99,
          category: "Electronics",
        },
        {
          name: "Coffee Mug",
          description: "Ceramic mug perfect for your morning coffee",
          price: 12.99,
          category: "Home & Kitchen",
        },
        {
          name: "Running Shoes",
          description: "Lightweight running shoes with excellent cushioning",
          price: 89.99,
          category: "Sports & Outdoors",
        },
        {
          name: "Notebook",
          description: "Spiral-bound notebook with 200 pages",
          price: 5.99,
          category: "Office Supplies",
        },
        {
          name: "Smartphone Case",
          description: "Protective case with wireless charging support",
          price: 29.99,
          category: "Electronics",
        },
        {
          name: "Desk Lamp",
          description: "LED desk lamp with adjustable brightness",
          price: 45.99,
          category: "Home & Kitchen",
        },
        {
          name: "Water Bottle",
          description: "Insulated stainless steel water bottle",
          price: 24.99,
          category: "Sports & Outdoors",
        },
        {
          name: "Pen Set",
          description: "Set of 5 premium ballpoint pens",
          price: 15.99,
          category: "Office Supplies",
        },
      ];

      for (const item of sampleItems) {
        this.sql.exec(
          "INSERT INTO items (name, description, price, category) VALUES (?, ?, ?, ?)",
          item.name,
          item.description,
          item.price,
          item.category,
        );
      }
    }
  }
}

export default {
  fetch: async (request: Request, env: Env) => {
    const url = new URL(request.url);
    const firstSegment = url.pathname.split("/")[1];
    const stub = env.MyDO.get(env.MyDO.idFromName(firstSegment));

    if (url.pathname === "/") {
      return new Response(`usage:

- Get the schema: GET /schema
- Items for any ID: GET /{id}
- Execute any query: GET /{id}/exec?query=YOUR_QUERY&binding=a&binding=b
- Any studio: GET /{id}/studio
`);
    }
    if (url.pathname.endsWith("/studio")) {
      // Add studio that can access any raw function
      return studioMiddleware(request, stub.raw, {
        basicAuth: { username: "admin", password: "test" },
      });
    }

    if (url.pathname === "/schema") {
      return new Response(await stub.getSchema());
    }

    if (url.pathname.endsWith("/exec")) {
      const query = url.searchParams.get("query");
      const bindings = url.searchParams.getAll("binding");
      const result = await stub.exec(query, ...bindings);
      return new Response(JSON.stringify(result, undefined, 2), {
        headers: { "content-type": "application/json" },
      });
    }

    const { array } = await stub.exec("SELECT * FROM items");
    return new Response(JSON.stringify(array, undefined, 2), {
      headers: { "content-type": "application/json" },
    });
  },
};
