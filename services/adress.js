const express = require("express");
const router = express.Router();
const createPool = require("../db");
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

// Create Address API
router.post("/address/create", authenticateJWT, async (req, res) => {
  const { country, state, pincode, addressString } = req.body;
  const user_id = req.userId; // Assuming authenticateJWT middleware sets req.userId

  if (!country) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "Country is required.",
    });
  }
  if (!state) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "State is required.",
    });
  }
  if (!pincode) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "Pincode is required.",
    });
  }
  if (!addressString) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "AddressString is required.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    const insertQuery = `
      INSERT INTO address (user_id, country, state, pincode, addressString)
      VALUES (?, ?, ?, ?, ?)
    `;
    const [result] = await connection.query(insertQuery, [
      user_id,
      country,
      state,
      pincode,
      addressString,
    ]);

    return res.status(201).send({
      status: 201,
      is_error: false,
      message: "Address successfully created",
      address_id: result.insertId,
    });
  } catch (error) {
    console.error("Error creating address:", error.message);
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

// List Addresses API
router.get("/address/list", authenticateJWT, async (req, res) => {
  const user_id = req.userId; // Assuming authenticateJWT middleware sets req.userId

  let connection;
  try {
    connection = await db.getConnection();

    const searchQuery = "SELECT * FROM address WHERE user_id = ?";
    const [addresses] = await connection.query(searchQuery, [user_id]);

    return res.status(200).send({
      status: 200,
      is_error: false,
      addresses: addresses,
    });
  } catch (error) {
    console.error("Error fetching addresses:", error.message);
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
// Update Address API
router.put("/address/update/:id", authenticateJWT, async (req, res) => {
  const user_id = req.userId; // Assuming authenticateJWT middleware sets req.userId
  const address_id = req.params.id; // Mandatory address ID from URL parameters
  const { country, state, pincode, addressString } = req.body; // Optional address fields to update

  if (!country && !state && !pincode && !addressString) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message:
        "At least one field (country, state, pincode, addressString) must be provided for update",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    // First, check if the address exists and belongs to the user
    const checkQuery = "SELECT * FROM address WHERE id = ? AND user_id = ?";
    const [existingAddress] = await connection.query(checkQuery, [
      address_id,
      user_id,
    ]);

    if (existingAddress.length === 0) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Address not found or does not belong to the user",
      });
    }

    // Build the update query dynamically based on the provided fields
    const updates = [];
    const values = [];

    if (country) {
      updates.push("country = ?");
      values.push(country);
    }
    if (state) {
      updates.push("state = ?");
      values.push(state);
    }
    if (pincode) {
      updates.push("pincode = ?");
      values.push(pincode);
    }
    if (addressString) {
      updates.push("addressString = ?");
      values.push(addressString);
    }

    values.push(address_id, user_id); // Add address_id and user_id for the WHERE clause

    const updateQuery = `
      UPDATE address 
      SET ${updates.join(", ")}
      WHERE id = ? AND user_id = ?`;

    await connection.query(updateQuery, values);

    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "Address updated successfully",
    });
  } catch (error) {
    console.error("Error updating address:", error.message);
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

// Delete Address API
router.delete("/address/delete/:id", authenticateJWT, async (req, res) => {
  const user_id = req.userId; // Assuming authenticateJWT middleware sets req.userId
  const address_id = req.params.id; // Mandatory address ID from URL parameters

  let connection;
  try {
    connection = await db.getConnection();

    // First, check if the address exists and belongs to the user
    const checkQuery = "SELECT * FROM address WHERE id = ? AND user_id = ?";
    const [existingAddress] = await connection.query(checkQuery, [
      address_id,
      user_id,
    ]);

    if (existingAddress.length === 0) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Address not found or does not belong to the user",
      });
    }

    // Delete the address
    const deleteQuery = "DELETE FROM address WHERE id = ? AND user_id = ?";
    await connection.query(deleteQuery, [address_id, user_id]);

    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "Address deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting address:", error.message);
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

module.exports = router;
