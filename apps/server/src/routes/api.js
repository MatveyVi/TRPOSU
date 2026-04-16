const express = require("express");
const rentalService = require("../services/rental-service");

const router = express.Router();

router.get("/bootstrap", async (request, response, next) => {
  try {
    const state = await rentalService.getState();
    response.json(state);
  } catch (error) {
    next(error);
  }
});

router.get("/points/:pointCode/status", async (request, response, next) => {
  try {
    const point = await rentalService.getPointStatus(request.params.pointCode);
    response.json(point);
  } catch (error) {
    next(error);
  }
});

router.get("/operations", async (request, response, next) => {
  try {
    const operationLog = await rentalService.getOperationLog();
    response.json({ operationLog });
  } catch (error) {
    next(error);
  }
});

router.post("/transport/add", async (request, response, next) => {
  try {
    const result = await rentalService.addTransport(request.body);
    const state = await rentalService.getState();
    response.status(201).json({ ...result, state });
  } catch (error) {
    next(error);
  }
});

router.post("/transport/rent", async (request, response, next) => {
  try {
    const result = await rentalService.rentTransport(request.body);
    const state = await rentalService.getState();
    response.status(201).json({ ...result, state });
  } catch (error) {
    next(error);
  }
});

router.post("/transport/return", async (request, response, next) => {
  try {
    const result = await rentalService.returnTransport(request.body);
    const state = await rentalService.getState();
    response.status(200).json({ ...result, state });
  } catch (error) {
    next(error);
  }
});

module.exports = { apiRouter: router };
