package main

import (
	"fmt"
	"log"
	"strconv"
	"strings"
)

// Rating categories (0-9 scale)
const (
	RatingDoNotUse        = 0
	RatingBroken          = 1
	RatingMajorIssues     = 2
	RatingMinorIssues     = 3
	RatingShouldImprove   = 4
	RatingCouldImprove    = 5
	RatingAverage         = 6
	RatingGood            = 7
	RatingVeryGood        = 8
	RatingExceptional     = 9
)

// Detail tags (0-9 scale)
const (
	DetailNothing           = 0
	DetailNeedsReview       = 1
	DetailNeedsImprovement  = 2
	DetailBugs              = 3
	DetailErrors            = 4
	DetailSpecial           = 5 // Context-dependent (positive or negative)
	DetailContent           = 6 // Context-dependent
	DetailQuality           = 7 // Context-dependent
	DetailUnique            = 8
	DetailExtreme           = 9 // Benevolent or Malicious
)

// Rating represents a single user's rating
type Rating struct {
	Address string `json:"address"` // Address of the rater
	Rating  uint64 `json:"rating"`  // The 0-99 rating number
	Height  uint64 `json:"height"`  // The block height this rating occurred
}

// RatingResult aggregates all ratings for a SCID
type RatingResult struct {
	SCID     string   `json:"scid"`
	Ratings  []Rating `json:"ratings,omitempty"` // All ratings for a SC
	Likes    uint64   `json:"likes"`             // Likes for a SC
	Dislikes uint64   `json:"dislikes"`          // Dislikes for a SC
	Average  float64  `json:"average"`           // Average category value (0-10 scale)
	Count    int      `json:"count"`             // Total number of ratings
}

// RatingCategories maps rating numbers to descriptions
var RatingCategories = map[uint64]string{
	0: "Do not use",
	1: "Broken",
	2: "Major issues",
	3: "Minor issues",
	4: "Should be improved",
	5: "Could be improved",
	6: "Average",
	7: "Good",
	8: "Very good",
	9: "Exceptional",
}

// NegativeDetails for ratings 0-4
var NegativeDetails = map[uint64]string{
	0: "Nothing",
	1: "Needs review",
	2: "Needs improvement",
	3: "Bugs",
	4: "Errors",
	5: "Inappropriate",
	6: "Incomplete",
	7: "Corrupted",
	8: "Plagiarized",
	9: "Malicious",
}

// PositiveDetails for ratings 5-9
var PositiveDetails = map[uint64]string{
	0: "Nothing",
	1: "Needs review",
	2: "Needs improvement",
	3: "Bugs",
	4: "Errors",
	5: "Visually appealing",
	6: "In depth",
	7: "Works well",
	8: "Unique",
	9: "Benevolent",
}

// ParseRating converts a 0-99 rating into category and detail
func ParseRating(rating uint64) (category string, detail string, categoryNum uint64, err error) {
	// First digit = category (0-9)
	categoryNum = rating / 10
	// Second digit = detail (0-9)
	detailNum := rating % 10

	// Get category
	var ok bool
	if category, ok = RatingCategories[categoryNum]; !ok {
		err = fmt.Errorf("unknown rating category: %d", categoryNum)
		return
	}

	// Get detail (positive or negative depending on category)
	isPositive := categoryNum >= 5
	if isPositive {
		detail = PositiveDetails[detailNum]
	} else {
		detail = NegativeDetails[detailNum]
	}

	if detail == "" {
		detail = "Unknown detail"
	}

	return
}

// ParseRatingString converts a rating to a human-readable string
func ParseRatingString(rating uint64) string {
	category, detail, _, err := ParseRating(rating)
	if err != nil {
		return "Unknown rating"
	}

	if detail == "Nothing" || detail == "" {
		return category
	}

	return fmt.Sprintf("%s (%s)", category, detail)
}

// GetRatingColor returns a color code for display
func GetRatingColor(categoryNum uint64) string {
	switch {
	case categoryNum <= 1:
		return "#ef4444" // Red - broken/dangerous
	case categoryNum <= 3:
		return "#f97316" // Orange - issues
	case categoryNum <= 5:
		return "#eab308" // Yellow - needs improvement
	case categoryNum <= 7:
		return "#22c55e" // Green - good
	default:
		return "#3b82f6" // Blue - exceptional
	}
}

// ShouldBlockContent determines if content should be blocked based on rating and user settings
func ShouldBlockContent(rating float64, settings map[string]interface{}) (bool, string) {
	minRating, ok := settings["min_rating"].(int)
	if !ok {
		minRating = 60 // Default
	}

	blockMalware, ok := settings["block_malware"].(bool)
	if !ok {
		blockMalware = true
	}

	// Convert average rating (0-10) to 0-100 scale for comparison
	ratingScaled := rating * 10

	// Block if rating indicates malware/broken (0-9 = Do not use/Broken)
	if blockMalware && rating < 2.0 {
		return true, fmt.Sprintf("Content blocked: Rating %.1f/10 indicates malicious or broken content", rating)
	}

	// Block if below user's quality threshold
	if ratingScaled < float64(minRating) {
		return true, fmt.Sprintf("Content blocked: Rating %.0f/100 below your threshold of %d", ratingScaled, minRating)
	}

	return false, ""
}

// GetRatingBadgeHTML returns HTML for a rating badge
func GetRatingBadgeHTML(result *RatingResult) string {
	if result == nil || result.Count == 0 {
		return `<span style="color: #6b7280;">No ratings yet</span>`
	}

	category, _, categoryNum, _ := ParseRating(uint64(result.Average * 10))
	color := GetRatingColor(categoryNum)

	return fmt.Sprintf(
		`<span style="color: %s; font-weight: bold;">★ %.1f/10</span> <span style="color: #9ca3af;">(%s - %d ratings)</span>`,
		color,
		result.Average,
		category,
		result.Count,
	)
}

// CalculateAverageRating computes the average rating from individual ratings
func CalculateAverageRating(ratings []Rating) float64 {
	if len(ratings) == 0 {
		return 0.0
	}

	var sum uint64
	for _, r := range ratings {
		// Extract category (first digit) from rating
		category := r.Rating / 10
		sum += category
	}

	return float64(sum) / float64(len(ratings))
}

// GetRatingResultForSCID fetches and calculates rating result for a SCID
// Tries Gnomon first (fast), falls back to blockchain direct query
func (a *App) GetRatingResultForSCID(scid string) (*RatingResult, error) {
	// Try to get from Gnomon first (fast, indexed)
	if a.gnomonClient != nil && a.gnomonClient.IsRunning() {
		result, err := a.gnomonClient.GetRating(scid)
		if err == nil && result != nil {
			return result, nil
		}
		// Log but continue to fallback
		log.Printf("Gnomon rating query failed: %v, falling back to blockchain", err)
	}

	// Fallback: Query blockchain directly
	result, err := a.fetchRatingsFromBlockchain(scid)
	if err != nil {
		log.Printf("Blockchain rating query failed: %v, returning default", err)
		// Return default rating on error
		return &RatingResult{
			SCID:     scid,
			Ratings:  []Rating{},
			Likes:    0,
			Dislikes: 0,
			Average:  6.0, // Default to "Average" if no ratings
			Count:    0,
		}, nil
	}

	return result, nil
}

// fetchRatingsFromBlockchain queries rating data directly from blockchain
func (a *App) fetchRatingsFromBlockchain(scid string) (*RatingResult, error) {
	// Get all smart contract variables
	vars, err := a.daemonClient.GetSCVariables(scid, true, true)
	if err != nil {
		return nil, fmt.Errorf("failed to get SC variables: %w", err)
	}

	result := &RatingResult{
		SCID:    scid,
		Ratings: make([]Rating, 0),
		Likes:   0,
		Dislikes: 0,
		Average: 0.0,
		Count:   0,
	}

	// Parse variables
	stringKeys, ok := vars["stringkeys"].(map[string]interface{})
	if !ok {
		return result, nil // No string keys, no ratings
	}

	// Get likes and dislikes counts
	if likesHex, ok := stringKeys["likes"].(string); ok {
		result.Likes = parseUint64FromHex(likesHex)
	}
	if dislikesHex, ok := stringKeys["dislikes"].(string); ok {
		result.Dislikes = parseUint64FromHex(dislikesHex)
	}

	// Parse individual ratings (stored as address → "rating_height")
	for key, value := range stringKeys {
		// Skip known metadata keys
		if key == "likes" || key == "dislikes" || key == "C" || key == "owner" {
			continue
		}

		// Check if key looks like a DERO address (starts with "dero")
		if !strings.HasPrefix(strings.ToLower(key), "dero") {
			continue
		}

		// Parse rating string (format: "rating_height")
		valueStr, ok := value.(string)
		if !ok {
			continue
		}

		decoded := decodeHexString(valueStr)
		parts := strings.Split(decoded, "_")
		if len(parts) < 2 {
			continue
		}

		ratingNum, err := strconv.ParseUint(parts[0], 10, 64)
		if err != nil || ratingNum > 99 {
			continue
		}

		heightNum, err := strconv.ParseUint(parts[1], 10, 64)
		if err != nil {
			continue
		}

		result.Ratings = append(result.Ratings, Rating{
			Address: key,
			Rating:  ratingNum,
			Height:  heightNum,
		})
	}

	// Calculate average from categories (first digit of rating)
	if len(result.Ratings) > 0 {
		var sum uint64
		for _, r := range result.Ratings {
			category := r.Rating / 10 // Extract category (0-9)
			sum += category
		}
		result.Average = float64(sum) / float64(len(result.Ratings))
		result.Count = len(result.Ratings)
	}

	return result, nil
}

// parseUint64FromHex tries to parse a hex string to uint64
func parseUint64FromHex(hexStr string) uint64 {
	decoded := decodeHexString(hexStr)
	val, err := strconv.ParseUint(decoded, 10, 64)
	if err != nil {
		return 0
	}
	return val
}

// =============================================
// Rating UI API Methods
// =============================================

// CategoryInfo represents a rating category with its details for UI
type CategoryInfo struct {
	Value       int    `json:"value"`
	Name        string `json:"name"`
	IsPositive  bool   `json:"isPositive"`
	Description string `json:"description,omitempty"`
	Color       string `json:"color"`
}

// DetailInfo represents a rating detail tag for UI
type DetailInfo struct {
	Value int    `json:"value"`
	Name  string `json:"name"`
}

// ParsedRating represents a fully parsed rating for UI display
type ParsedRating struct {
	RatingValue  int    `json:"ratingValue"`
	Category     int    `json:"category"`
	Detail       int    `json:"detail"`
	CategoryName string `json:"categoryName"`
	DetailName   string `json:"detailName"`
	IsPositive   bool   `json:"isPositive"`
	DisplayText  string `json:"displayText"`
	Color        string `json:"color"`
}

// GetRatingCategories returns all rating categories with metadata for UI
func (a *App) GetRatingCategories() map[string]interface{} {
	categories := make([]CategoryInfo, 0, 10)

	descriptions := map[int]string{
		0: "Content is harmful, dangerous, or completely unusable",
		1: "Content does not function at all",
		2: "Content has significant problems affecting usability",
		3: "Content has some issues but is mostly functional",
		4: "Content works but has room for improvement",
		5: "Content is acceptable but could be better",
		6: "Content meets expectations",
		7: "Content exceeds expectations",
		8: "Content is excellent quality",
		9: "Content is outstanding and exemplary",
	}

	for i := 0; i <= 9; i++ {
		cat := CategoryInfo{
			Value:       i,
			Name:        RatingCategories[uint64(i)],
			IsPositive:  i >= 5,
			Description: descriptions[i],
			Color:       GetRatingColor(uint64(i)),
		}
		categories = append(categories, cat)
	}

	return map[string]interface{}{
		"success":    true,
		"categories": categories,
	}
}

// GetRatingDetails returns detail tags for a given category
func (a *App) GetRatingDetails(category int) map[string]interface{} {
	if category < 0 || category > 9 {
		return map[string]interface{}{
			"success": false,
			"error":   "Category must be 0-9",
		}
	}

	isPositive := category >= 5
	detailMap := NegativeDetails
	if isPositive {
		detailMap = PositiveDetails
	}

	details := make([]DetailInfo, 0, 10)
	for i := 0; i <= 9; i++ {
		details = append(details, DetailInfo{
			Value: i,
			Name:  detailMap[uint64(i)],
		})
	}

	return map[string]interface{}{
		"success":    true,
		"category":   category,
		"isPositive": isPositive,
		"details":    details,
	}
}

// ParseRatingForUI parses a 0-99 rating into its components for display
func (a *App) ParseRatingForUI(rating int) map[string]interface{} {
	if rating < 0 || rating > 99 {
		return map[string]interface{}{
			"success": false,
			"error":   "Rating must be 0-99",
		}
	}

	categoryNum := rating / 10
	detailNum := rating % 10
	isPositive := categoryNum >= 5

	categoryName := RatingCategories[uint64(categoryNum)]

	var detailName string
	if isPositive {
		detailName = PositiveDetails[uint64(detailNum)]
	} else {
		detailName = NegativeDetails[uint64(detailNum)]
	}

	displayText := categoryName
	if detailName != "Nothing" {
		displayText = categoryName + " (" + detailName + ")"
	}

	return map[string]interface{}{
		"success": true,
		"parsed": ParsedRating{
			RatingValue:  rating,
			Category:     categoryNum,
			Detail:       detailNum,
			CategoryName: categoryName,
			DetailName:   detailName,
			IsPositive:   isPositive,
			DisplayText:  displayText,
			Color:        GetRatingColor(uint64(categoryNum)),
		},
	}
}

// BuildRating builds a 0-99 rating from category and detail
func (a *App) BuildRating(category, detail int) map[string]interface{} {
	if category < 0 || category > 9 {
		return map[string]interface{}{
			"success": false,
			"error":   "Category must be 0-9",
		}
	}
	if detail < 0 || detail > 9 {
		return map[string]interface{}{
			"success": false,
			"error":   "Detail must be 0-9",
		}
	}

	rating := category*10 + detail

	// Return the parsed rating
	return a.ParseRatingForUI(rating)
}

// SubmitRatingWithPicker submits a rating using category and detail values
func (a *App) SubmitRatingWithPicker(scid string, category, detail int) map[string]interface{} {
	if category < 0 || category > 9 {
		return map[string]interface{}{
			"success": false,
			"error":   "Category must be 0-9",
		}
	}
	if detail < 0 || detail > 9 {
		return map[string]interface{}{
			"success": false,
			"error":   "Detail must be 0-9",
		}
	}

	rating := category*10 + detail
	
	// Use the existing RateTELAApp method
	return a.RateTELAApp(scid, rating)
}

// GetRatingsBreakdown returns a detailed breakdown of all ratings for a SCID
func (a *App) GetRatingsBreakdown(scid string) map[string]interface{} {
	a.logToConsole(fmt.Sprintf("[RATE] Getting ratings breakdown for: %s", scid[:16]+"..."))

	result, err := a.GetRatingResultForSCID(scid)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to fetch ratings: %v", err),
		}
	}

	// Create category distribution (0-9)
	categoryDist := make([]map[string]interface{}, 10)
	for i := 0; i < 10; i++ {
		categoryDist[i] = map[string]interface{}{
			"category":    i,
			"name":        RatingCategories[uint64(i)],
			"count":       0,
			"color":       GetRatingColor(uint64(i)),
			"percentage":  0.0,
		}
	}

	// Parse individual ratings
	parsedRatings := []map[string]interface{}{}
	for _, r := range result.Ratings {
		category := r.Rating / 10
		detail := r.Rating % 10
		isPositive := category >= 5

		var detailName string
		if isPositive {
			detailName = PositiveDetails[uint64(detail)]
		} else {
			detailName = NegativeDetails[uint64(detail)]
		}

		// Update distribution count
		if int(category) < 10 {
			categoryDist[category]["count"] = categoryDist[category]["count"].(int) + 1
		}

		parsedRatings = append(parsedRatings, map[string]interface{}{
			"address":      truncateAddress(r.Address),
			"fullAddress":  r.Address,
			"rating":       r.Rating,
			"height":       r.Height,
			"category":     category,
			"categoryName": RatingCategories[uint64(category)],
			"detail":       detail,
			"detailName":   detailName,
			"isPositive":   isPositive,
			"color":        GetRatingColor(uint64(category)),
		})
	}

	// Calculate percentages
	if result.Count > 0 {
		for i := 0; i < 10; i++ {
			count := categoryDist[i]["count"].(int)
			categoryDist[i]["percentage"] = float64(count) / float64(result.Count) * 100
		}
	}

	// Calculate sentiment distribution
	positiveCount := 0
	negativeCount := 0
	for _, r := range result.Ratings {
		if r.Rating/10 >= 5 {
			positiveCount++
		} else {
			negativeCount++
		}
	}

	a.logToConsole(fmt.Sprintf("[OK] Found %d ratings for SCID", result.Count))

	return map[string]interface{}{
		"success":          true,
		"scid":             scid,
		"totalRatings":     result.Count,
		"likes":            result.Likes,
		"dislikes":         result.Dislikes,
		"average":          result.Average,
		"averageDisplay":   fmt.Sprintf("%.1f/10", result.Average),
		"categoryDist":     categoryDist,
		"ratings":          parsedRatings,
		"positiveCount":    positiveCount,
		"negativeCount":    negativeCount,
		"positivePercent":  float64(positiveCount) / float64(max(1, result.Count)) * 100,
		"negativePercent":  float64(negativeCount) / float64(max(1, result.Count)) * 100,
	}
}

// truncateAddress shortens a DERO address for display
func truncateAddress(addr string) string {
	if len(addr) > 20 {
		return addr[:8] + "..." + addr[len(addr)-8:]
	}
	return addr
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

