// The names of the eating states (EVE-02). A plain module: the server page and the client form both
// read it (a constant exported from a "use client" file reaches a server component as a reference).
export const EAT_LABEL: Record<string, string> = { EATEN: "evett", PARTIAL: "nem evett meg mindent", NOT_EATEN: "nem evett", FASTING: "koplalónap" };
