import { expect, test } from "@playwright/test";

test("runs the bundled model locally and never requests a third-party origin", async ({
  page,
  baseURL,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.goto(baseURL ?? "/");
  await page
    .getByLabel("Text to extract")
    .fill("A magnetic field exerts a force on moving charged particles.");
  await page.getByRole("button", { name: "Build knowledge graph" }).click();

  const map = page.getByRole("region", { name: "Interactive knowledge map" });
  await expect(map).toBeVisible({
    timeout: 45_000,
  });
  const route = map.getByLabel("Directed relationship map");
  await expect(
    route.getByRole("button", { name: "magnetic field concept" }),
  ).toBeVisible();
  await expect(
    route.getByRole("button", {
      name: "force on moving charged particles concept",
    }),
  ).toBeVisible();
  await expect(route.getByText("Source evidence")).toBeVisible();

  const origin = new URL(baseURL ?? "http://127.0.0.1:4173").origin;
  expect(requests.filter((url) => new URL(url).origin !== origin)).toEqual([]);
});
