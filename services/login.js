const express = require("express");
const router = express.Router();
const createPool = require("../db");

const fs = require("fs");
const multer = require("multer");

const jwt = require("jsonwebtoken");
const SECRET_KEY = "your_secret_key";

const db = createPool();

const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(" ")[1];

    jwt.verify(token, SECRET_KEY, (err, user) => {
      if (err) {
        return res.sendStatus(403);
      }

      req.userId = user.userId;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

router.post("/user/create", async (req, res) => {
  const { first_name, last_name, email, password } = req.body;
  if (!first_name) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "First name is required.",
    });
  }
  if (!last_name) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "last name is required.",
    });
  }
  if (!email) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "email is required.",
    });
  }
  if (!password) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "password is required.",
    });
  }
  if (password.length < 6) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "Password must be at least 6 characters long.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    const searchQuery = "select * FROM users WHERE email = ?";
    const [searchResults] = await connection.query(searchQuery, [email]);

    if (searchResults.length > 0) {
      console.log("User already exists", searchResults);
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "User already exists",
      });
    }

    const insertQuery =
      "insert into users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)";
    const [result] = await connection.query(insertQuery, [
      first_name,
      last_name,
      email,
      password,
    ]);
    const [user] = await connection.query(searchQuery, [email]);

    console.log("Created new User:", user[0].first_name);
    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "successfully inserted",
      user_details: user[0],
    });
  } catch (error) {
    console.error("Error creating user:", error.message);
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

router.post("/user/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "email is required.",
    });
  }
  if (!password) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "password is required.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    const searchQuery = "select * from users where email = ?";
    const [searchResults] = await connection.query(searchQuery, [email]);

    if (searchResults.length == 0) {
      console.log("User doesnt exists", searchResults);
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "User doesnt exists",
      });
    }
    const user = searchResults[0];
    if (user.password != password) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "invalid password",
      });
    }

    const token = jwt.sign({ userId: user.id }, SECRET_KEY, {
      expiresIn: "1h",
    });

    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "sucess",
      user: searchResults[0],
      token: token,
    });
  } catch (error) {
    console.error("Error fetchinh user:", error.message);
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

router.post("/user/change_password", authenticateJWT, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "currentPassword is required.",
    });
  }
  if (!newPassword) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "newPassword is required.",
    });
  }
  if (currentPassword == newPassword) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "passwords should not be same.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();
    const userId = req.userId;

    const searchQuery = "SELECT * FROM users WHERE id = ?";
    const [searchResults] = await connection.query(searchQuery, [userId]);

    if (searchResults.length == 0) {
      console.log("User doesnt exists", searchResults);
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "User doesnt exists",
      });
    }
    const user = searchResults[0];

    if (user.password !== currentPassword) {
      return res.status(200).json({
        status: 200,
        is_error: true,
        message: "Incorrect current password.",
      });
    }

    await connection.query("update users set password = ? where id = ?", [
      newPassword,
      userId,
    ]);

    return res.status(200).json({
      status: 200,
      is_error: false,
      message: "Password updated successfully.",
    });
  } catch (error) {
    console.error("Error fetchinh user:", error.message);
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

router.get("/user/details", authenticateJWT, async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const userId = req.userId;

    const searchQuery = "SELECT * FROM users WHERE id = ?";
    const [searchResults] = await connection.query(searchQuery, [userId]);

    if (searchResults.length == 0) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "User doesn't exist",
      });
    }

    const user = searchResults[0];
    const imagePath = user.imagePath;

    // let imageBase64 = null;

    // if (imagePath && fs.existsSync(imagePath)) {
    //     const imageData = fs.readFileSync(imagePath);
    //     imageBase64 = imageData.toString('base64');
    // }

    // user.image = imageBase64;

    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "success",
      user: user,
    });
  } catch (error) {
    console.error("Error fetching user:", error.message);
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

router.get("/user/list", authenticateJWT, async (req, res) => {
  let connection;
  try {
    console.log("Users list");
    connection = await db.getConnection();
    const userId = req.userId;

    const searchQuery = "SELECT * FROM users WHERE id = ?";
    const [searchResults] = await connection.query(searchQuery, [userId]);

    if (searchResults.length == 0) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "User doesn't exist",
      });
    }

    const user = searchResults[0];

    const listUserQuery = "SELECT * FROM users";
    const [listUsersQuery] = await connection.query(listUserQuery, [userId]);

    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "success",
      users: listUsersQuery,
      totalCount: listUsersQuery.length,
    });
  } catch (error) {
    console.error("Error fetching user:", error.message);
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});
// Update User API
router.post("/user/update_user", authenticateJWT, async (req, res) => {
  const { first_name, last_name, phone, password } = req.body;
  const userId = req.userId; // Assuming authenticateJWT middleware sets req.userId

  // Check if at least one field is provided for the update
  if (!first_name && !last_name && !phone && !password) {
    return res.status(400).send({
      status: 400,
      is_error: true,
      message:
        "At least one field (first_name, last_name, phone, password) must be provided for update",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    // First, check if the user exists
    const searchQuery = "SELECT * FROM users WHERE id = ?";
    const [searchResults] = await connection.query(searchQuery, [userId]);

    if (searchResults.length == 0) {
      return res.status(404).send({
        status: 404,
        is_error: true,
        message: "User doesn't exist",
      });
    }

    // Build the update query dynamically based on the provided fields
    const updates = [];
    const values = [];

    if (first_name) {
      updates.push("first_name = ?");
      values.push(first_name);
    }
    if (last_name) {
      updates.push("last_name = ?");
      values.push(last_name);
    }
    if (password) {
      updates.push("password = ?");
      values.push(password);
    }
    if (phone) {
      updates.push("phone_number = ?");
      values.push(phone);
    }

    values.push(userId); // Add userId for the WHERE clause

    const updateQuery = `
      UPDATE users 
      SET ${updates.join(", ")}
      WHERE id = ?`;

    await connection.query(updateQuery, values);

    return res.status(200).json({
      status: 200,
      is_error: false,
      message: "User details updated successfully.",
    });
  } catch (error) {
    console.error("Error updating user:", error.message);
    return res.status(500).send({
      status: 500,
      is_error: true,
      message: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

module.exports = router;
