const mysql = require("mysql2/promise");
require("dotenv").config();

const createPool = () => {
    return mysql.createPool({
        connectionLimit: 100,
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USERNAME,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        port: process.env.MYSQL_PORT || 3306,
        insecureAuth: true,
    });
};

module.exports = createPool;
