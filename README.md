# Queryable Object

Improved version of [browsable object](https://github.com/outerbase/browsable-durable-object) that uses RPC instaed of needing fetch. This has the benefit of not exposing any endpoints when you expose your durable object to the public web. Besides, since the studio is not tied to a single DO, we can use things like [multistub](https://github.com/janwilmake/multistub) to connect the studio with more than one DO! This is an alternative to [remote-sql-cursor](https://github.com/janwilmake/remote-sql-cursor) - it has a slightly different API, but is a lot simpler, and more secure by default!

## usage

```ts
import { DurableObject } from "cloudflare:workers";
import {
  studioMiddleware,
  Queryable,
  QueryableHandler,
  // Extend this instead of @Queryable
  QueryableObject
} from "queryable-object";



export type ExecFn =
/** this adds these functions to your DO Stub:
{
  exec: (query: string, ...bindings: any[]) => Promise<{columnNames: string[]; rowsRead: number; rowsWritten: number; array: any[]; one: any; }>;
  raw: (query: string, ...bindings: any[]) => Promise<{ columnNames: string[]; rowsRead: number; rowsWritten: number; raw: SqlStorageValue[][]; }>;
  // gets the full schema
  getSchema: () => Promise<string>;
};
*/
type Env = { MyDO: DurableObjectNamespace<MyDO & QueryableHandler> };

@Queryable()
export class MyDO extends DurableObject {
  sql: SqlStorage;
  env: any;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.env = env;
    this.sql = state.storage.sql;
    // Do stuff with your DO
  }

  //....
}

export default {
  fetch: async (request: Request, env: Env) => {
    const url = new URL(request.url);
    const firstSegment = url.pathname.split("/")[1];
    const stub = env.MyDO.get(env.MyDO.idFromName(firstSegment));

    if (url.pathname === "/") {
      return new Response(`usage:

- Items for any ID: GET /{id}
- Any studio: GET /{id}/studio
`);
    }

    if (url.pathname.endsWith("/studio")) {
      // Add studio that can access any raw function
      return studioMiddleware(request, stub.raw, {
        basicAuth: { username: "admin", password: "test" },
      });
    }

    // You can query your DO from the outside, with a very well-known interface!
    const { array } = await stub.exec("SELECT * FROM items");
    return new Response(JSON.stringify(array, undefined, 2), {
      headers: { "content-type": "application/json" },
    });
  },
};
```
