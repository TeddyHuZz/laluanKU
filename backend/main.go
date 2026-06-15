package main

import (
	"log"

	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "service": "LaluanKU API"})
	})

	// Routes will go here
	// r.GET("/api/route", handlers.GetRoute)

	log.Println("LaluanKU backend running on :3001")
	r.Run(":3001")
}
