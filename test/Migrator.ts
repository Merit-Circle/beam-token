import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BeamToken, BeamToken__factory, Migrator, Migrator__factory } from "../typechain";
import hre from "hardhat";
import TimeTraveler from "../utils/TimeTraveler";
import { parseEther } from "@ethersproject/units";
import { AddressZero } from "@ethersproject/constants";

const NAME = "NAME";
const SYMBOL = "SYMBOL";
const INITIAL_SUPPLY = parseEther("10000");
const MIGRATION_RATE = parseEther("100");
const MIGRATION_AMOUNT = parseEther("600");

describe("Migrator", function () {
  this.timeout(200000);

  let beamToken: BeamToken;
  let meritToken: BeamToken;
  let migrator: Migrator;
  let deployer: SignerWithAddress;
  let migrant: SignerWithAddress;
  let accounts: SignerWithAddress[];
  const timeTraveler = new TimeTraveler(hre.network.provider);

  before(async () => {
    [deployer, migrant, ...accounts] = await hre.ethers.getSigners();
    beamToken = await new BeamToken__factory(deployer).deploy(NAME, SYMBOL);
    meritToken = await new BeamToken__factory(deployer).deploy(NAME, SYMBOL);
    migrator = await new Migrator__factory(deployer).deploy(meritToken.address, beamToken.address, MIGRATION_RATE);

    // bytes32 private constant MINTER_ROLE = keccak256("MINTER_ROLE");
    // bytes32 private constant BURNER_ROLE = keccak256("BURNER_ROLE");
    const MINTER_ROLE = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";
    const BURNER_ROLE = "0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848";

    await meritToken.grantRole(MINTER_ROLE, deployer.address);
    await meritToken.mint(deployer.address, INITIAL_SUPPLY);

    await meritToken.grantRole(BURNER_ROLE, migrator.address);
    await beamToken.grantRole(MINTER_ROLE, migrator.address);

    await timeTraveler.snapshot();
  });

  beforeEach(async () => {
    await timeTraveler.revertSnapshot();
  });

  describe("constructor", async () => {
    it("Constructor args should be used", async () => {
      const source = await migrator.source();
      const destination = await migrator.destination();
      const migrationRate = await migrator.migrationRate();

      expect(source).to.eq(meritToken.address);
      expect(destination).to.eq(beamToken.address);
      expect(migrationRate).to.eq(MIGRATION_RATE);
    });
  });
  describe("migrate", async () => {
    it("Should work when called by a token owner and Migrator has Minter and Burner role", async () => {
      const MINT_AMOUNT = parseEther("1500");
      await meritToken.connect(deployer).mint(migrant.address, MINT_AMOUNT);

      const meritTotalSupply = await meritToken.totalSupply();
      const beamTotalSupply = await beamToken.totalSupply();

      const meritBalance = await meritToken.balanceOf(migrant.address);
      const beamBalance = await beamToken.balanceOf(migrant.address);

      await migrator.connect(migrant).migrate(MIGRATION_AMOUNT);

      const meritBalanceFinal = await meritToken.balanceOf(migrant.address);
      const beamBalanceFinal = await beamToken.balanceOf(migrant.address);

      const meritTotalSupplyFinal = await meritToken.totalSupply();
      const beamTotalSupplyFinal = await beamToken.totalSupply();

      expect(meritTotalSupply).to.eq(meritTotalSupplyFinal.add(MIGRATION_AMOUNT));
      expect(beamTotalSupply).to.eq(
        beamTotalSupplyFinal.sub(MIGRATION_AMOUNT.mul(MIGRATION_RATE).div(parseEther("1"))),
      );
      expect(meritBalance).to.eq(meritBalanceFinal.add(MIGRATION_AMOUNT));
      expect(beamBalance).to.eq(beamBalanceFinal.sub(MIGRATION_AMOUNT.mul(MIGRATION_RATE).div(parseEther("1"))));
    });
    it("Migrating should emit the correct event", async () => {
      const MINT_AMOUNT = parseEther("1500");
      await meritToken.connect(deployer).mint(migrant.address, MINT_AMOUNT);

      await migrator.connect(migrant).migrate(MIGRATION_AMOUNT);

      await expect(migrator.connect(migrant).migrate(MIGRATION_AMOUNT))
        .to.emit(migrator, "Migrated")
        .withArgs(migrant.address, MIGRATION_AMOUNT.mul(MIGRATION_RATE).div(parseEther("1")));
    });
    it("Should revert when called by a token owner without the amount", async () => {
      const MINT_AMOUNT = parseEther("1500");
      await meritToken.connect(deployer).mint(migrant.address, MINT_AMOUNT);

      await expect(migrator.connect(migrant).migrate(MINT_AMOUNT.add(parseEther("1")))).to.revertedWith(
        "ERC20: burn amount exceeds balance",
      );
    });
    it("Should revert when Migrator contract does not have burner role in source token", async () => {
      const MINT_AMOUNT = parseEther("1500");
      await meritToken.connect(deployer).mint(migrant.address, MINT_AMOUNT);

      const BURNER_ROLE = "0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848";
      await meritToken.revokeRole(BURNER_ROLE, migrator.address);

      await expect(migrator.connect(migrant).migrate(MIGRATION_AMOUNT)).to.revertedWith("NoRole()");
    });
    it("Should revert when Migrator contract does not have minter role in destination token", async () => {
      const MINT_AMOUNT = parseEther("1500");
      await meritToken.connect(deployer).mint(migrant.address, MINT_AMOUNT);

      const MINTER_ROLE = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";
      await beamToken.revokeRole(MINTER_ROLE, migrator.address);

      await expect(migrator.connect(migrant).migrate(MIGRATION_AMOUNT)).to.revertedWith("NoRole()");
    });
  });
});
