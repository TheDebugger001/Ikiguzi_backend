"use strict";

/**
 * MongoDB keeps dates to the millisecond; MySQL DATETIME defaults to whole
 * seconds, which would reorder records created within the same second
 * (messages, notifications, orders). Converts every DATETIME column to DATETIME(3).
 */
const columns = async (queryInterface, precision) => queryInterface.sequelize.query(
  `SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE = 'datetime' AND DATETIME_PRECISION = ${precision}
     AND TABLE_NAME NOT IN ('SequelizeMeta', 'SequelizeData')`,
  { type: queryInterface.sequelize.QueryTypes.SELECT }
);

const alter = async (queryInterface, rows, type, nowDefault) => {
  for (const c of rows) {
    const isNow = c.COLUMN_DEFAULT && /CURRENT_TIMESTAMP/i.test(c.COLUMN_DEFAULT);
    const nullable = c.IS_NULLABLE === "YES" ? "NULL" : "NOT NULL";
    const def = isNow ? ` DEFAULT ${nowDefault}` : "";
    await queryInterface.sequelize.query(`ALTER TABLE \`${c.TABLE_NAME}\` MODIFY \`${c.COLUMN_NAME}\` ${type} ${nullable}${def}`);
  }
};

module.exports = {
  async up(queryInterface) {
    await alter(queryInterface, await columns(queryInterface, 0), "DATETIME(3)", "CURRENT_TIMESTAMP(3)");
  },
  async down(queryInterface) {
    await alter(queryInterface, await columns(queryInterface, 3), "DATETIME", "CURRENT_TIMESTAMP");
  },
};
