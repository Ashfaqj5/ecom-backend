const express = require("express");
const router = express.Router();
const createPool = require("../db");

const fs = require("fs");
const multer = require("multer");

const jwt = require("jsonwebtoken");
const SECRET_KEY = "your_secret_key";
const s3 = require("./s3");

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

router.post("/cart/add-item", authenticateJWT, async (req, res) => {
  const { product_id } = req.body;
  const user_id = req.userId; // Assuming authenticateJWT middleware sets req.userId

  if (!product_id) {
    return res.status(400).send({
      status: 400,
      is_error: true,
      message: "Product ID  are required.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    // Get the product price
    const getProductQuery = "SELECT totalPrice FROM product WHERE id = ?";
    const [product] = await connection.query(getProductQuery, [product_id]);

    if (product.length === 0) {
      return res.status(404).send({
        status: 404,
        is_error: true,
        message: "Product not found",
      });
    }

    const productPrice = product[0].totalPrice;
    const itemCost = productPrice;

    // Check if a non-deleted cart already exists for the user
    const searchCartQuery =
      "SELECT id, total_cost FROM cart WHERE user_id = ? AND deleted_at IS NULL";
    const [carts] = await connection.query(searchCartQuery, [user_id]);

    let cart_id;
    let total_cost;
    if (carts.length > 0) {
      total_cost = carts[0].total_cost;
      cart_id = carts[0].id;
    } else {
      // Create a new cart
      const createCartQuery =
        "INSERT INTO cart (user_id, total_cost, created_at) VALUES (?, ?, NOW())";
      const [result] = await connection.query(createCartQuery, [
        user_id,
        itemCost,
      ]);
      cart_id = result.insertId;
      total_cost = 0;
    }

    // Insert the cart item
    const createCartItemQuery = `
        INSERT INTO cart_items (cart_id, product_id, quantity, cost)
        VALUES (?, ?, ?, ?)
      `;
    await connection.query(createCartItemQuery, [
      cart_id,
      product_id,
      1,
      itemCost,
    ]);

    // Update the total cost in the cart
    const updateCartTotalCostQuery =
      "UPDATE cart SET total_cost = ? WHERE id = ?";
    await connection.query(updateCartTotalCostQuery, [
      total_cost + itemCost,
      cart_id,
    ]);

    return res.status(201).send({
      status: 201,
      is_error: false,
      message: "Cart item successfully added",
      cart_id: cart_id,
    });
  } catch (error) {
    console.error("Error adding cart item:", error.message);
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

router.post("/cart/update-item", authenticateJWT, async (req, res) => {
  const quantity = 1;
  const { product_id, operation } = req.body;
  const user_id = req.userId; // Assuming authenticateJWT middleware sets req.userId

  if (!product_id) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "Product ID is required.",
    });
  }
  if (!operation) {
    return res.status(200).send({
      status: 200,
      is_error: true,
      message: "Operation is required.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();

    // Get the product price
    const getProductQuery = "SELECT totalPrice FROM product WHERE id = ?";
    const [product] = await connection.query(getProductQuery, [product_id]);

    if (product.length === 0) {
      return res.status(404).send({
        status: 404,
        is_error: true,
        message: "Product not found",
      });
    }

    const productPrice = product[0].totalPrice;
    const newCost = productPrice * quantity;

    // Check if a non-deleted cart already exists for the user
    const searchCartQuery =
      "SELECT id, total_cost FROM cart WHERE user_id = ? AND deleted_at IS NULL";
    const [carts] = await connection.query(searchCartQuery, [user_id]);

    if (carts.length === 0) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Cart not found",
      });
    }

    const cart_id = carts[0].id;

    // Get the current cart item
    const getCartItemQuery =
      "SELECT id, quantity, cost FROM cart_items WHERE cart_id = ? AND product_id = ?";
    const [cartItems] = await connection.query(getCartItemQuery, [
      cart_id,
      product_id,
    ]);

    if (cartItems.length === 0) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Cart item not found",
      });
    }

    const cartItem = cartItems[0];
    const oldCost = cartItem.cost;
    const oldQuantity = cartItem.quantity;

    var totalCost, totalQuantity, updatedTotalCost;
    if (operation == "add") {
      totalCost = oldCost + newCost;
      totalQuantity = oldQuantity + quantity;
      updatedTotalCost = carts[0].total_cost + newCost;
    } else {
      totalCost = oldCost - newCost;
      totalQuantity = oldQuantity - quantity;
      updatedTotalCost = carts[0].total_cost - newCost;
    }
    if (totalQuantity <= 0) {
      // Delete the cart item if quantity is zero or less
      const deleteCartItemQuery = `
          DELETE FROM cart_items 
          WHERE id = ?
        `;
      await connection.query(deleteCartItemQuery, [cartItem.id]);

      const updateCartTotalCostQuery =
        "UPDATE cart SET total_cost = ? WHERE id = ?";
      await connection.query(updateCartTotalCostQuery, [
        updatedTotalCost,
        cart_id,
      ]);

      return res.status(200).send({
        status: 200,
        is_error: false,
        message: "Cart item successfully deleted",
        cart_id: cart_id,
      });
    }
    // Update the cart item with the new quantity and cost
    const updateCartItemQuery = `
        UPDATE cart_items 
        SET quantity = ?, cost = ? 
        WHERE id = ?
      `;
    await connection.query(updateCartItemQuery, [
      totalQuantity,
      totalCost,
      cartItem.id,
    ]);

    // Update the total cost in the cart
    const updateCartTotalCostQuery =
      "UPDATE cart SET total_cost = ? WHERE id = ?";
    await connection.query(updateCartTotalCostQuery, [
      updatedTotalCost,
      cart_id,
    ]);

    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "Cart item successfully updated",
      cart_id: cart_id,
    });
  } catch (error) {
    console.error("Error updating cart item:", error.message);
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
router.get("/cart/items", authenticateJWT, async (req, res) => {
  const user_id = req.userId; // Assuming authenticateJWT middleware sets req.userId

  let connection;
  try {
    connection = await db.getConnection();

    // Check if a non-deleted cart exists for the user
    const searchCartQuery =
      "SELECT id FROM cart WHERE user_id = ? AND deleted_at IS NULL";
    const [carts] = await connection.query(searchCartQuery, [user_id]);

    if (carts.length === 0) {
      return res.status(200).send({
        status: 200,
        is_error: true,
        message: "Cart not found",
      });
    }

    const cart_id = carts[0].id;
    console.log("Cart ID", cart_id);
    // Get all items in the cart along with product details
    const getCartItemsQuery = `
      SELECT 
        cart_items.*, 
        product.*
      FROM cart_items 
      JOIN product ON cart_items.product_id = product.id 
      WHERE cart_items.cart_id = ?
    `;
    const [cartItems] = await connection.query(getCartItemsQuery, [cart_id]);

    const signedUrlExpireSeconds = 60 * 5;
    // Generate pre-signed URLs for each product's attachment link
    cartItems.forEach((item) => {
      if (item.attachmentLink) {
        const signedUrl = s3.getSignedUrl("getObject", {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: item.attachmentLink,
          Expires: signedUrlExpireSeconds,
        });
        item.signedUrl = signedUrl; // Add the signed URL to the cart item object
      }
    });

    return res.status(200).send({
      status: 200,
      is_error: false,
      message: "Cart items retrieved successfully",
      cart_items: cartItems,
    });
  } catch (error) {
    console.error("Error retrieving cart items:", error.message);
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
