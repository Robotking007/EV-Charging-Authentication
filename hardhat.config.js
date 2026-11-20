require("@nomicfoundation/hardhat-toolbox");
const { validatorRpc, readCourseAccounts } = require("./scripts/course-config");

const courseDeploy = process.env.EV_COURSE_DEPLOY === "1";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun"
    }
  },
  networks: {
    besu: {
      url: process.env.BESU_RPC_URL || validatorRpc(),
      accounts: courseDeploy
        ? [readCourseAccounts().admin]
        : process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : []
    }
  }
};
