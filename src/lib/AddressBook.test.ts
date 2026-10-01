import { describe, expect, test } from "bun:test";

import { AddressBook, type AddressBookData } from "./AddressBook.ts";

const A = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const B = "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV";
const empty: AddressBookData = { wallets: [], groups: [] };

describe("AddressBook", () => {
  test("adds wallets and groups", () => {
    let book = AddressBook.addWallet(empty, "alice", A, "team");
    book = AddressBook.addWallet(book, "bob", B, "team");
    expect(book).toEqual({
      wallets: [
        { name: "alice", address: A },
        { name: "bob", address: B },
      ],
      groups: [{ name: "team", addresses: [A, B] }],
    });
  });

  test("rejects name clashes and built-in names", () => {
    const book = AddressBook.addWallet(empty, "alice", A, "team");
    expect(() => AddressBook.addWallet(book, "alice", B)).toThrow(
      /already refers/
    );
    expect(() => AddressBook.addWallet(book, "team", B)).toThrow(
      /already a group/
    );
    expect(() => AddressBook.addWallet(empty, "demo", A)).toThrow(/built-in/);
    expect(() => AddressBook.addWallet(empty, "x", "nope")).toThrow(
      /Invalid Solana address/
    );
  });

  test("removes a wallet from a group, then the wallet and empty group", () => {
    let book = AddressBook.addWallet(empty, "alice", A, "team");
    book = AddressBook.addWallet(book, "bob", B, "team");
    book = AddressBook.remove(book, "bob", "team");
    expect(book.groups).toEqual([{ name: "team", addresses: [A] }]);
    book = AddressBook.remove(book, "alice");
    expect(book).toEqual({
      wallets: [{ name: "bob", address: B }],
      groups: [],
    });
  });

  test("resolves addresses, names, groups and the demo group", () => {
    const book = AddressBook.addWallet(empty, "alice", A, "team");
    expect(AddressBook.resolve(`team,${B},alice`, book)).toEqual([A, B]);
    expect(AddressBook.resolve("demo", book)).toEqual([
      "DemoSX9F2zXfQLtBr56Yr5he15P7viZWsYJpSDAX3tKG",
      "jupE53639uCTuXk3VgRmUuDoafR9baGfLZf4T5DBH5H",
      "tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd",
    ]);
    expect(() => AddressBook.resolve("unknown", book)).toThrow(
      /not a valid Solana address/
    );
  });
});
