import { DurableObject } from "cloudflare:workers";
export { studioMiddleware } from "./studio-middleware";
export class QueryableHandler {
  public sql: SqlStorage | undefined;

  constructor(sql: SqlStorage | undefined) {
    this.sql = sql;
  }

  public getSchema(): string {
    if (!this.sql) {
      throw new Error("SQL storage not available");
    }

    const result = this.exec(
      `SELECT sql FROM "main".sqlite_schema WHERE type = 'table' AND sql IS NOT NULL ORDER BY name`,
    );

    let schema = "";
    for (const row of result.array) {
      if (row.sql) {
        schema += row.sql + ";\n\n";
      }
    }

    // Also get indexes
    const indexResult = this.exec(
      `SELECT sql FROM "main".sqlite_schema WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`,
    );

    if (indexResult.array.length > 0) {
      schema += "-- Indexes\n";
      for (const row of indexResult.array) {
        if (row.sql) {
          schema += row.sql + ";\n";
        }
      }
    }

    return schema.trim();
  }

  public raw(query: string, ...bindings: any[]) {
    if (!this.sql) {
      throw new Error("SQL storage not available");
    }

    const cursor = this.sql.exec(query, ...bindings);
    const raw = Array.from(cursor.raw());
    return {
      columnNames: cursor.columnNames,
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
      raw,
    };
  }

  public exec(query: string, ...bindings: any[]) {
    if (!this.sql) {
      throw new Error("SQL storage not available");
    }

    const cursor = this.sql.exec(query, ...bindings);
    const array = cursor.toArray();
    return {
      columnNames: cursor.columnNames,
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
      array: array as any[],
      one: array[0] as any,
    };
  }
}

export function Queryable() {
  return function <T extends { new (...args: any[]): any }>(constructor: T) {
    return class extends constructor {
      public _queryableHandler?: QueryableHandler;

      // Initialize handler when needed
      private ensureQueryableHandler() {
        if (!this._queryableHandler) {
          this._queryableHandler = new QueryableHandler(this.sql);
        }
        return this._queryableHandler;
      }

      public raw(query: string, ...bindings: any[]) {
        return this.ensureQueryableHandler().raw(query, ...bindings);
      }

      public getSchema() {
        return this.ensureQueryableHandler().getSchema();
      }

      public exec(query: string, ...bindings: any[]) {
        return this.ensureQueryableHandler().exec(query, ...bindings);
      }
    };
  };
}

export class QueryableObject<TEnv = any> extends DurableObject<TEnv> {
  public sql: SqlStorage | undefined;
  protected _queryableHandler?: QueryableHandler;

  constructor(state: DurableObjectState, env: TEnv) {
    super(state, env);
    this.sql = state.storage.sql;
  }

  private ensureQueryableHandler() {
    if (!this._queryableHandler) {
      this._queryableHandler = new QueryableHandler(this.sql);
    }
    return this._queryableHandler;
  }

  public getSchema() {
    return this.ensureQueryableHandler().getSchema();
  }

  public raw(query: string, ...bindings: any[]) {
    return this.ensureQueryableHandler().raw(query, ...bindings);
  }

  public exec(query: string, ...bindings: any[]) {
    return this.ensureQueryableHandler().exec(query, ...bindings);
  }
}
