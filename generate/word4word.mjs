import dotenv from 'dotenv'

dotenv.config()
import {ChatGPTAPI} from 'chatgpt'
import * as fs from 'fs';

let API = null;

const translations = {
    'osnb1': {
        long: "norwegian, bokmål",
        language: "nb"
    }
}

const books = [
    {
        "id": 1, "name": "Første Mosebok", "chapter_count": 50,
        chapters: [
            {"chapterId": 1, "verse_count": 31},
            {"chapterId": 2, "verse_count": 25},
            {"chapterId": 3, "verse_count": 24},
            {"chapterId": 4, "verse_count": 26},
            {"chapterId": 5, "verse_count": 32},
            {"chapterId": 6, "verse_count": 22},
            {"chapterId": 7, "verse_count": 24},
            {"chapterId": 8, "verse_count": 22},
            {"chapterId": 9, "verse_count": 29},
            {"chapterId": 10, "verse_count": 32},
            {"chapterId": 11, "verse_count": 32},
            {"chapterId": 12, "verse_count": 20},
            {"chapterId": 13, "verse_count": 18},
            {"chapterId": 14, "verse_count": 24},
            {"chapterId": 15, "verse_count": 21},
            {"chapterId": 16, "verse_count": 16},
            {"chapterId": 17, "verse_count": 27},
            {"chapterId": 18, "verse_count": 33},
            {"chapterId": 19, "verse_count": 38},
            {"chapterId": 20, "verse_count": 18},
            {"chapterId": 21, "verse_count": 34},
            {"chapterId": 22, "verse_count": 24},
            {"chapterId": 23, "verse_count": 20},
            {"chapterId": 24, "verse_count": 67},
            {"chapterId": 25, "verse_count": 34},
            {"chapterId": 26, "verse_count": 35},
            {"chapterId": 27, "verse_count": 46},
            {"chapterId": 28, "verse_count": 22},
            {"chapterId": 29, "verse_count": 35},
            {"chapterId": 30, "verse_count": 43},
            {"chapterId": 31, "verse_count": 55},
            {"chapterId": 32, "verse_count": 43},
            {"chapterId": 33, "verse_count": 34},
            {"chapterId": 34, "verse_count": 31},
            {"chapterId": 35, "verse_count": 22},
            {"chapterId": 36, "verse_count": 43},
            {"chapterId": 37, "verse_count": 36},
            {"chapterId": 38, "verse_count": 30},
            {"chapterId": 39, "verse_count": 23},
            {"chapterId": 40, "verse_count": 23},
            {"chapterId": 41, "verse_count": 57},
            {"chapterId": 42, "verse_count": 38},
            {"chapterId": 43, "verse_count": 34},
            {"chapterId": 44, "verse_count": 34},
            {"chapterId": 45, "verse_count": 28},
            {"chapterId": 46, "verse_count": 34},
            {"chapterId": 47, "verse_count": 31},
            {"chapterId": 48, "verse_count": 22},
            {"chapterId": 49, "verse_count": 33},
            {"chapterId": 50, "verse_count": 26}
        ]
    },
    {
        "id": 2, "name": "Andre Mosebok", "chapter_count": 40, chapters: [
            {"chapterId": 1, "verse_count": 22},
            {"chapterId": 2, "verse_count": 25},
            {"chapterId": 3, "verse_count": 22},
            {"chapterId": 4, "verse_count": 31},
            {"chapterId": 5, "verse_count": 23},
            {"chapterId": 6, "verse_count": 30},
            {"chapterId": 7, "verse_count": 25},
            {"chapterId": 8, "verse_count": 32},
            {"chapterId": 9, "verse_count": 35},
            {"chapterId": 10, "verse_count": 29},
            {"chapterId": 11, "verse_count": 10},
            {"chapterId": 12, "verse_count": 51},
            {"chapterId": 13, "verse_count": 22},
            {"chapterId": 14, "verse_count": 31},
            {"chapterId": 15, "verse_count": 27},
            {"chapterId": 16, "verse_count": 36},
            {"chapterId": 17, "verse_count": 16},
            {"chapterId": 18, "verse_count": 27},
            {"chapterId": 19, "verse_count": 25},
            {"chapterId": 20, "verse_count": 26},
            {"chapterId": 21, "verse_count": 36},
            {"chapterId": 22, "verse_count": 31},
            {"chapterId": 23, "verse_count": 33},
            {"chapterId": 24, "verse_count": 18},
            {"chapterId": 25, "verse_count": 40},
            {"chapterId": 26, "verse_count": 37},
            {"chapterId": 27, "verse_count": 21},
            {"chapterId": 28, "verse_count": 43},
            {"chapterId": 29, "verse_count": 46},
            {"chapterId": 30, "verse_count": 38},
            {"chapterId": 31, "verse_count": 18},
            {"chapterId": 32, "verse_count": 35},
            {"chapterId": 33, "verse_count": 23},
            {"chapterId": 34, "verse_count": 35},
            {"chapterId": 35, "verse_count": 35},
            {"chapterId": 36, "verse_count": 38},
            {"chapterId": 37, "verse_count": 29},
            {"chapterId": 38, "verse_count": 31},
            {"chapterId": 39, "verse_count": 43},
            {"chapterId": 40, "verse_count": 38}
        ]
    },
    {
        "id": 3, "name": "Tredje Mosebok", "chapter_count": 27, chapters: [
            {"chapterId": 1, "verse_count": 17},
            {"chapterId": 2, "verse_count": 16},
            {"chapterId": 3, "verse_count": 17},
            {"chapterId": 4, "verse_count": 35},
            {"chapterId": 5, "verse_count": 19},
            {"chapterId": 6, "verse_count": 30},
            {"chapterId": 7, "verse_count": 38},
            {"chapterId": 8, "verse_count": 36},
            {"chapterId": 9, "verse_count": 24},
            {"chapterId": 10, "verse_count": 20},
            {"chapterId": 11, "verse_count": 47},
            {"chapterId": 12, "verse_count": 8},
            {"chapterId": 13, "verse_count": 59},
            {"chapterId": 14, "verse_count": 57},
            {"chapterId": 15, "verse_count": 33},
            {"chapterId": 16, "verse_count": 34},
            {"chapterId": 17, "verse_count": 16},
            {"chapterId": 18, "verse_count": 30},
            {"chapterId": 19, "verse_count": 37},
            {"chapterId": 20, "verse_count": 27},
            {"chapterId": 21, "verse_count": 24},
            {"chapterId": 22, "verse_count": 33},
            {"chapterId": 23, "verse_count": 44},
            {"chapterId": 24, "verse_count": 23},
            {"chapterId": 25, "verse_count": 55},
            {"chapterId": 26, "verse_count": 46},
            {"chapterId": 27, "verse_count": 34}
        ]
    },
    {
        "id": 4, "name": "Fjerde Mosebok", "chapter_count": 36, chapters: [
            {"chapterId": 1, "verse_count": 54},
            {"chapterId": 2, "verse_count": 34},
            {"chapterId": 3, "verse_count": 51},
            {"chapterId": 4, "verse_count": 49},
            {"chapterId": 5, "verse_count": 31},
            {"chapterId": 6, "verse_count": 27},
            {"chapterId": 7, "verse_count": 89},
            {"chapterId": 8, "verse_count": 26},
            {"chapterId": 9, "verse_count": 23},
            {"chapterId": 10, "verse_count": 36},
            {"chapterId": 11, "verse_count": 35},
            {"chapterId": 12, "verse_count": 16},
            {"chapterId": 13, "verse_count": 33},
            {"chapterId": 14, "verse_count": 45},
            {"chapterId": 15, "verse_count": 41},
            {"chapterId": 16, "verse_count": 50},
            {"chapterId": 17, "verse_count": 13},
            {"chapterId": 18, "verse_count": 32},
            {"chapterId": 19, "verse_count": 22},
            {"chapterId": 20, "verse_count": 29},
            {"chapterId": 21, "verse_count": 35},
            {"chapterId": 22, "verse_count": 41},
            {"chapterId": 23, "verse_count": 30},
            {"chapterId": 24, "verse_count": 25},
            {"chapterId": 25, "verse_count": 18},
            {"chapterId": 26, "verse_count": 65},
            {"chapterId": 27, "verse_count": 23},
            {"chapterId": 28, "verse_count": 31},
            {"chapterId": 29, "verse_count": 40},
            {"chapterId": 30, "verse_count": 16},
            {"chapterId": 31, "verse_count": 54},
            {"chapterId": 32, "verse_count": 42},
            {"chapterId": 33, "verse_count": 56},
            {"chapterId": 34, "verse_count": 29},
            {"chapterId": 35, "verse_count": 34},
            {"chapterId": 36, "verse_count": 13}
        ]
    },
    {
        "id": 5, "name": "Femte Mosebok", "chapter_count": 34, chapters: [
            {"chapterId": 1, "verse_count": 46},
            {"chapterId": 2, "verse_count": 37},
            {"chapterId": 3, "verse_count": 29},
            {"chapterId": 4, "verse_count": 49},
            {"chapterId": 5, "verse_count": 33},
            {"chapterId": 6, "verse_count": 25},
            {"chapterId": 7, "verse_count": 26},
            {"chapterId": 8, "verse_count": 20},
            {"chapterId": 9, "verse_count": 29},
            {"chapterId": 10, "verse_count": 22},
            {"chapterId": 11, "verse_count": 32},
            {"chapterId": 12, "verse_count": 32},
            {"chapterId": 13, "verse_count": 18},
            {"chapterId": 14, "verse_count": 29},
            {"chapterId": 15, "verse_count": 23},
            {"chapterId": 16, "verse_count": 22},
            {"chapterId": 17, "verse_count": 20},
            {"chapterId": 18, "verse_count": 22},
            {"chapterId": 19, "verse_count": 21},
            {"chapterId": 20, "verse_count": 20},
            {"chapterId": 21, "verse_count": 23},
            {"chapterId": 22, "verse_count": 30},
            {"chapterId": 23, "verse_count": 25},
            {"chapterId": 24, "verse_count": 22},
            {"chapterId": 25, "verse_count": 19},
            {"chapterId": 26, "verse_count": 19},
            {"chapterId": 27, "verse_count": 26},
            {"chapterId": 28, "verse_count": 68},
            {"chapterId": 29, "verse_count": 29},
            {"chapterId": 30, "verse_count": 20},
            {"chapterId": 31, "verse_count": 30},
            {"chapterId": 32, "verse_count": 52},
            {"chapterId": 33, "verse_count": 29},
            {"chapterId": 34, "verse_count": 12}
        ]
    },
    {
        "id": 6, "name": "Josvas bok", "chapter_count": 24, chapters: [
            {"chapterId": 1, "verse_count": 18},
            {"chapterId": 2, "verse_count": 24},
            {"chapterId": 3, "verse_count": 17},
            {"chapterId": 4, "verse_count": 24},
            {"chapterId": 5, "verse_count": 15},
            {"chapterId": 6, "verse_count": 27},
            {"chapterId": 7, "verse_count": 26},
            {"chapterId": 8, "verse_count": 35},
            {"chapterId": 9, "verse_count": 27},
            {"chapterId": 10, "verse_count": 43},
            {"chapterId": 11, "verse_count": 23},
            {"chapterId": 12, "verse_count": 24},
            {"chapterId": 13, "verse_count": 33},
            {"chapterId": 14, "verse_count": 15},
            {"chapterId": 15, "verse_count": 63},
            {"chapterId": 16, "verse_count": 10},
            {"chapterId": 17, "verse_count": 18},
            {"chapterId": 18, "verse_count": 28},
            {"chapterId": 19, "verse_count": 51},
            {"chapterId": 20, "verse_count": 9},
            {"chapterId": 21, "verse_count": 45},
            {"chapterId": 22, "verse_count": 34},
            {"chapterId": 23, "verse_count": 16},
            {"chapterId": 24, "verse_count": 33}
        ]
    },
    {
        "id": 7, "name": "Dommernes bok", "chapter_count": 21, chapters: [
            {"chapterId": 1, "verse_count": 36},
            {"chapterId": 2, "verse_count": 23},
            {"chapterId": 3, "verse_count": 31},
            {"chapterId": 4, "verse_count": 24},
            {"chapterId": 5, "verse_count": 31},
            {"chapterId": 6, "verse_count": 40},
            {"chapterId": 7, "verse_count": 25},
            {"chapterId": 8, "verse_count": 35},
            {"chapterId": 9, "verse_count": 57},
            {"chapterId": 10, "verse_count": 18},
            {"chapterId": 11, "verse_count": 40},
            {"chapterId": 12, "verse_count": 15},
            {"chapterId": 13, "verse_count": 25},
            {"chapterId": 14, "verse_count": 20},
            {"chapterId": 15, "verse_count": 20},
            {"chapterId": 16, "verse_count": 31},
            {"chapterId": 17, "verse_count": 13},
            {"chapterId": 18, "verse_count": 31},
            {"chapterId": 19, "verse_count": 30},
            {"chapterId": 20, "verse_count": 48},
            {"chapterId": 21, "verse_count": 25}
        ]
    },
    {
        "id": 8, "name": "Ruts bok", "chapter_count": 4, chapters: [
            {"chapterId": 1, "verse_count": 22},
            {"chapterId": 2, "verse_count": 23},
            {"chapterId": 3, "verse_count": 18},
            {"chapterId": 4, "verse_count": 22}
        ]
    },
    {
        "id": 9, "name": "Første Samuelsbok", "chapter_count": 31, chapters: [
            {"chapterId": 1, "verse_count": 28},
            {"chapterId": 2, "verse_count": 36},
            {"chapterId": 3, "verse_count": 21},
            {"chapterId": 4, "verse_count": 22},
            {"chapterId": 5, "verse_count": 12},
            {"chapterId": 6, "verse_count": 21},
            {"chapterId": 7, "verse_count": 17},
            {"chapterId": 8, "verse_count": 22},
            {"chapterId": 9, "verse_count": 27},
            {"chapterId": 10, "verse_count": 27},
            {"chapterId": 11, "verse_count": 15},
            {"chapterId": 12, "verse_count": 25},
            {"chapterId": 13, "verse_count": 23},
            {"chapterId": 14, "verse_count": 52},
            {"chapterId": 15, "verse_count": 35},
            {"chapterId": 16, "verse_count": 23},
            {"chapterId": 17, "verse_count": 58},
            {"chapterId": 18, "verse_count": 30},
            {"chapterId": 19, "verse_count": 24},
            {"chapterId": 20, "verse_count": 42},
            {"chapterId": 21, "verse_count": 15},
            {"chapterId": 22, "verse_count": 23},
            {"chapterId": 23, "verse_count": 29},
            {"chapterId": 24, "verse_count": 22},
            {"chapterId": 25, "verse_count": 44},
            {"chapterId": 26, "verse_count": 25},
            {"chapterId": 27, "verse_count": 12},
            {"chapterId": 28, "verse_count": 25},
            {"chapterId": 29, "verse_count": 11},
            {"chapterId": 30, "verse_count": 31},
            {"chapterId": 31, "verse_count": 13}
        ]
    },
    {
        "id": 10, "name": "Andre Samuelsbok", "chapter_count": 24, chapters: [
            {"chapterId": 1, "verse_count": 27},
            {"chapterId": 2, "verse_count": 32},
            {"chapterId": 3, "verse_count": 39},
            {"chapterId": 4, "verse_count": 12},
            {"chapterId": 5, "verse_count": 25},
            {"chapterId": 6, "verse_count": 23},
            {"chapterId": 7, "verse_count": 29},
            {"chapterId": 8, "verse_count": 18},
            {"chapterId": 9, "verse_count": 13},
            {"chapterId": 10, "verse_count": 19},
            {"chapterId": 11, "verse_count": 27},
            {"chapterId": 12, "verse_count": 31},
            {"chapterId": 13, "verse_count": 39},
            {"chapterId": 14, "verse_count": 33},
            {"chapterId": 15, "verse_count": 37},
            {"chapterId": 16, "verse_count": 23},
            {"chapterId": 17, "verse_count": 29},
            {"chapterId": 18, "verse_count": 30},
            {"chapterId": 19, "verse_count": 32},
            {"chapterId": 20, "verse_count": 22},
            {"chapterId": 21, "verse_count": 34},
            {"chapterId": 22, "verse_count": 23},
            {"chapterId": 23, "verse_count": 58},
            {"chapterId": 24, "verse_count": 25}
        ]
    },
    {
        "id": 11, "name": "Første Kongebok", "chapter_count": 22, chapters: [
            {"chapterId": 1, "verse_count": 53},
            {"chapterId": 2, "verse_count": 46},
            {"chapterId": 3, "verse_count": 28},
            {"chapterId": 4, "verse_count": 34},
            {"chapterId": 5, "verse_count": 18},
            {"chapterId": 6, "verse_count": 33},
            {"chapterId": 7, "verse_count": 29},
            {"chapterId": 8, "verse_count": 66},
            {"chapterId": 9, "verse_count": 28},
            {"chapterId": 10, "verse_count": 29},
            {"chapterId": 11, "verse_count": 43},
            {"chapterId": 12, "verse_count": 33},
            {"chapterId": 13, "verse_count": 34},
            {"chapterId": 14, "verse_count": 31},
            {"chapterId": 15, "verse_count": 34},
            {"chapterId": 16, "verse_count": 34},
            {"chapterId": 17, "verse_count": 24},
            {"chapterId": 18, "verse_count": 46},
            {"chapterId": 19, "verse_count": 21},
            {"chapterId": 20, "verse_count": 43},
            {"chapterId": 21, "verse_count": 29},
            {"chapterId": 22, "verse_count": 53}
        ]
    },
    {
        "id": 12, "name": "Andre Kongebok", "chapter_count": 25, chapters: [
            {"chapterId": 1, "verse_count": 18},
            {"chapterId": 2, "verse_count": 25},
            {"chapterId": 3, "verse_count": 27},
            {"chapterId": 4, "verse_count": 44},
            {"chapterId": 5, "verse_count": 27},
            {"chapterId": 6, "verse_count": 33},
            {"chapterId": 7, "verse_count": 20},
            {"chapterId": 8, "verse_count": 29},
            {"chapterId": 9, "verse_count": 37},
            {"chapterId": 10, "verse_count": 36},
            {"chapterId": 11, "verse_count": 21},
            {"chapterId": 12, "verse_count": 21},
            {"chapterId": 13, "verse_count": 25},
            {"chapterId": 14, "verse_count": 29},
            {"chapterId": 15, "verse_count": 38},
            {"chapterId": 16, "verse_count": 20},
            {"chapterId": 17, "verse_count": 41},
            {"chapterId": 18, "verse_count": 37},
            {"chapterId": 19, "verse_count": 37},
            {"chapterId": 20, "verse_count": 21},
            {"chapterId": 21, "verse_count": 26},
            {"chapterId": 22, "verse_count": 20},
            {"chapterId": 23, "verse_count": 37},
            {"chapterId": 24, "verse_count": 20},
            {"chapterId": 25, "verse_count": 30}
        ]
    },
    {
        "id": 13, "name": "Første Krønikebok", "chapter_count": 29, chapters: [
            {"chapterId": 1, "verse_count": 54},
            {"chapterId": 2, "verse_count": 55},
            {"chapterId": 3, "verse_count": 24},
            {"chapterId": 4, "verse_count": 43},
            {"chapterId": 5, "verse_count": 41},
            {"chapterId": 6, "verse_count": 66},
            {"chapterId": 7, "verse_count": 40},
            {"chapterId": 8, "verse_count": 40},
            {"chapterId": 9, "verse_count": 44},
            {"chapterId": 10, "verse_count": 14},
            {"chapterId": 11, "verse_count": 47},
            {"chapterId": 12, "verse_count": 40},
            {"chapterId": 13, "verse_count": 14},
            {"chapterId": 14, "verse_count": 17},
            {"chapterId": 15, "verse_count": 29},
            {"chapterId": 16, "verse_count": 43},
            {"chapterId": 17, "verse_count": 27},
            {"chapterId": 18, "verse_count": 17},
            {"chapterId": 19, "verse_count": 19},
            {"chapterId": 20, "verse_count": 8},
            {"chapterId": 21, "verse_count": 30},
            {"chapterId": 22, "verse_count": 19},
            {"chapterId": 23, "verse_count": 32},
            {"chapterId": 24, "verse_count": 31},
            {"chapterId": 25, "verse_count": 31},
            {"chapterId": 26, "verse_count": 32},
            {"chapterId": 27, "verse_count": 34},
            {"chapterId": 28, "verse_count": 21},
            {"chapterId": 29, "verse_count": 30}
        ]
    },
    {
        "id": 14, "name": "Andre Krønikebok", "chapter_count": 36, chapters: [
            {"chapterId": 1, "verse_count": 17},
            {"chapterId": 2, "verse_count": 18},
            {"chapterId": 3, "verse_count": 17},
            {"chapterId": 4, "verse_count": 22},
            {"chapterId": 5, "verse_count": 14},
            {"chapterId": 6, "verse_count": 42},
            {"chapterId": 7, "verse_count": 22},
            {"chapterId": 8, "verse_count": 18},
            {"chapterId": 9, "verse_count": 31},
            {"chapterId": 10, "verse_count": 19},
            {"chapterId": 11, "verse_count": 23},
            {"chapterId": 12, "verse_count": 16},
            {"chapterId": 13, "verse_count": 22},
            {"chapterId": 14, "verse_count": 15},
            {"chapterId": 15, "verse_count": 19},
            {"chapterId": 16, "verse_count": 14},
            {"chapterId": 17, "verse_count": 19},
            {"chapterId": 18, "verse_count": 34},
            {"chapterId": 19, "verse_count": 11},
            {"chapterId": 20, "verse_count": 37},
            {"chapterId": 21, "verse_count": 30},
            {"chapterId": 22, "verse_count": 23},
            {"chapterId": 23, "verse_count": 25},
            {"chapterId": 24, "verse_count": 22},
            {"chapterId": 25, "verse_count": 27},
            {"chapterId": 26, "verse_count": 17},
            {"chapterId": 27, "verse_count": 25},
            {"chapterId": 28, "verse_count": 22},
            {"chapterId": 29, "verse_count": 35},
            {"chapterId": 30, "verse_count": 27},
            {"chapterId": 31, "verse_count": 23},
            {"chapterId": 32, "verse_count": 33},
            {"chapterId": 33, "verse_count": 25},
            {"chapterId": 34, "verse_count": 33},
            {"chapterId": 35, "verse_count": 27},
            {"chapterId": 36, "verse_count": 23}
        ]
    },
    {
        "id": 15, "name": "Esras bok", "chapter_count": 10, chapters: [
            {"chapterId": 1, "verse_count": 11},
            {"chapterId": 2, "verse_count": 70},
            {"chapterId": 3, "verse_count": 13},
            {"chapterId": 4, "verse_count": 24},
            {"chapterId": 5, "verse_count": 17},
            {"chapterId": 6, "verse_count": 22},
            {"chapterId": 7, "verse_count": 28},
            {"chapterId": 8, "verse_count": 36},
            {"chapterId": 9, "verse_count": 15},
            {"chapterId": 10, "verse_count": 44}
        ]
    },
    {
        "id": 16, "name": "Nehemjas bok", "chapter_count": 13, chapters: [
            {"chapterId": 1, "verse_count": 11},
            {"chapterId": 2, "verse_count": 20},
            {"chapterId": 3, "verse_count": 32},
            {"chapterId": 4, "verse_count": 23},
            {"chapterId": 5, "verse_count": 19},
            {"chapterId": 6, "verse_count": 19},
            {"chapterId": 7, "verse_count": 73},
            {"chapterId": 8, "verse_count": 18},
            {"chapterId": 9, "verse_count": 38},
            {"chapterId": 10, "verse_count": 39},
            {"chapterId": 11, "verse_count": 36},
            {"chapterId": 12, "verse_count": 47},
            {"chapterId": 13, "verse_count": 31}
        ]
    },
    {
        "id": 17, "name": "Esters bok", "chapter_count": 10, chapters: [
            {"chapterId": 1, "verse_count": 22},
            {"chapterId": 2, "verse_count": 23},
            {"chapterId": 3, "verse_count": 15},
            {"chapterId": 4, "verse_count": 17},
            {"chapterId": 5, "verse_count": 14},
            {"chapterId": 6, "verse_count": 14},
            {"chapterId": 7, "verse_count": 10},
            {"chapterId": 8, "verse_count": 17},
            {"chapterId": 9, "verse_count": 32},
            {"chapterId": 10, "verse_count": 3}
        ]
    },
    {
        "id": 18, "name": "Jobs bok", "chapter_count": 42, chapters: [
            {"chapterId": 1, "verse_count": 22},
            {"chapterId": 2, "verse_count": 13},
            {"chapterId": 3, "verse_count": 26},
            {"chapterId": 4, "verse_count": 21},
            {"chapterId": 5, "verse_count": 27},
            {"chapterId": 6, "verse_count": 30},
            {"chapterId": 7, "verse_count": 21},
            {"chapterId": 8, "verse_count": 22},
            {"chapterId": 9, "verse_count": 35},
            {"chapterId": 10, "verse_count": 22},
            {"chapterId": 11, "verse_count": 20},
            {"chapterId": 12, "verse_count": 25},
            {"chapterId": 13, "verse_count": 28},
            {"chapterId": 14, "verse_count": 22},
            {"chapterId": 15, "verse_count": 35},
            {"chapterId": 16, "verse_count": 22},
            {"chapterId": 17, "verse_count": 16},
            {"chapterId": 18, "verse_count": 21},
            {"chapterId": 19, "verse_count": 29},
            {"chapterId": 20, "verse_count": 29},
            {"chapterId": 21, "verse_count": 34},
            {"chapterId": 22, "verse_count": 30},
            {"chapterId": 23, "verse_count": 17},
            {"chapterId": 24, "verse_count": 25},
            {"chapterId": 25, "verse_count": 6},
            {"chapterId": 26, "verse_count": 14},
            {"chapterId": 27, "verse_count": 23},
            {"chapterId": 28, "verse_count": 28},
            {"chapterId": 29, "verse_count": 25},
            {"chapterId": 30, "verse_count": 31},
            {"chapterId": 31, "verse_count": 40},
            {"chapterId": 32, "verse_count": 22},
            {"chapterId": 33, "verse_count": 33},
            {"chapterId": 34, "verse_count": 37},
            {"chapterId": 35, "verse_count": 16},
            {"chapterId": 36, "verse_count": 33},
            {"chapterId": 37, "verse_count": 24},
            {"chapterId": 38, "verse_count": 41},
            {"chapterId": 39, "verse_count": 30},
            {"chapterId": 40, "verse_count": 24},
            {"chapterId": 41, "verse_count": 34},
            {"chapterId": 42, "verse_count": 17}
        ]
    },
    {
        "id": 19, "name": "Salmenes bok", "chapter_count": 150, chapters: [
            {"chapterId": 1, "verse_count": 6},
            {"chapterId": 2, "verse_count": 12},
            {"chapterId": 3, "verse_count": 8},
            {"chapterId": 4, "verse_count": 8},
            {"chapterId": 5, "verse_count": 12},
            {"chapterId": 6, "verse_count": 10},
            {"chapterId": 7, "verse_count": 17},
            {"chapterId": 8, "verse_count": 9},
            {"chapterId": 9, "verse_count": 20},
            {"chapterId": 10, "verse_count": 18},
            {"chapterId": 11, "verse_count": 7},
            {"chapterId": 12, "verse_count": 8},
            {"chapterId": 13, "verse_count": 6},
            {"chapterId": 14, "verse_count": 7},
            {"chapterId": 15, "verse_count": 5},
            {"chapterId": 16, "verse_count": 11},
            {"chapterId": 17, "verse_count": 15},
            {"chapterId": 18, "verse_count": 50},
            {"chapterId": 19, "verse_count": 14},
            {"chapterId": 20, "verse_count": 9},
            {"chapterId": 21, "verse_count": 13},
            {"chapterId": 22, "verse_count": 31},
            {"chapterId": 23, "verse_count": 6},
            {"chapterId": 24, "verse_count": 10},
            {"chapterId": 25, "verse_count": 22},
            {"chapterId": 26, "verse_count": 12},
            {"chapterId": 27, "verse_count": 14},
            {"chapterId": 28, "verse_count": 9},
            {"chapterId": 29, "verse_count": 11},
            {"chapterId": 30, "verse_count": 12},
            {"chapterId": 31, "verse_count": 24},
            {"chapterId": 32, "verse_count": 11},
            {"chapterId": 33, "verse_count": 22},
            {"chapterId": 34, "verse_count": 22},
            {"chapterId": 35, "verse_count": 28},
            {"chapterId": 36, "verse_count": 12},
            {"chapterId": 37, "verse_count": 40},
            {"chapterId": 38, "verse_count": 22},
            {"chapterId": 39, "verse_count": 13},
            {"chapterId": 40, "verse_count": 17},
            {"chapterId": 41, "verse_count": 13},
            {"chapterId": 42, "verse_count": 11},
            {"chapterId": 43, "verse_count": 5},
            {"chapterId": 44, "verse_count": 26},
            {"chapterId": 45, "verse_count": 17},
            {"chapterId": 46, "verse_count": 11},
            {"chapterId": 47, "verse_count": 9},
            {"chapterId": 48, "verse_count": 14},
            {"chapterId": 49, "verse_count": 20},
            {"chapterId": 50, "verse_count": 23},
            {"chapterId": 51, "verse_count": 19},
            {"chapterId": 52, "verse_count": 9},
            {"chapterId": 53, "verse_count": 6},
            {"chapterId": 54, "verse_count": 7},
            {"chapterId": 55, "verse_count": 23},
            {"chapterId": 56, "verse_count": 13},
            {"chapterId": 57, "verse_count": 11},
            {"chapterId": 58, "verse_count": 11},
            {"chapterId": 59, "verse_count": 17},
            {"chapterId": 60, "verse_count": 12},
            {"chapterId": 61, "verse_count": 8},
            {"chapterId": 62, "verse_count": 12},
            {"chapterId": 63, "verse_count": 11},
            {"chapterId": 64, "verse_count": 10},
            {"chapterId": 65, "verse_count": 13},
            {"chapterId": 66, "verse_count": 20},
            {"chapterId": 67, "verse_count": 7},
            {"chapterId": 68, "verse_count": 35},
            {"chapterId": 69, "verse_count": 36},
            {"chapterId": 70, "verse_count": 5},
            {"chapterId": 71, "verse_count": 24},
            {"chapterId": 72, "verse_count": 20},
            {"chapterId": 73, "verse_count": 28},
            {"chapterId": 74, "verse_count": 23},
            {"chapterId": 75, "verse_count": 10},
            {"chapterId": 76, "verse_count": 12},
            {"chapterId": 77, "verse_count": 20},
            {"chapterId": 78, "verse_count": 72},
            {"chapterId": 79, "verse_count": 13},
            {"chapterId": 80, "verse_count": 19},
            {"chapterId": 81, "verse_count": 16},
            {"chapterId": 82, "verse_count": 8},
            {"chapterId": 83, "verse_count": 18},
            {"chapterId": 84, "verse_count": 12},
            {"chapterId": 85, "verse_count": 13},
            {"chapterId": 86, "verse_count": 17},
            {"chapterId": 87, "verse_count": 7},
            {"chapterId": 88, "verse_count": 18},
            {"chapterId": 89, "verse_count": 52},
            {"chapterId": 90, "verse_count": 17},
            {"chapterId": 91, "verse_count": 16},
            {"chapterId": 92, "verse_count": 15},
            {"chapterId": 93, "verse_count": 5},
            {"chapterId": 94, "verse_count": 23},
            {"chapterId": 95, "verse_count": 11},
            {"chapterId": 96, "verse_count": 13},
            {"chapterId": 97, "verse_count": 12},
            {"chapterId": 98, "verse_count": 9},
            {"chapterId": 99, "verse_count": 9},
            {"chapterId": 100, "verse_count": 5},
            {"chapterId": 101, "verse_count": 8},
            {"chapterId": 102, "verse_count": 28},
            {"chapterId": 103, "verse_count": 22},
            {"chapterId": 104, "verse_count": 35},
            {"chapterId": 105, "verse_count": 45},
            {"chapterId": 106, "verse_count": 48},
            {"chapterId": 107, "verse_count": 43},
            {"chapterId": 108, "verse_count": 13},
            {"chapterId": 109, "verse_count": 31},
            {"chapterId": 110, "verse_count": 7},
            {"chapterId": 111, "verse_count": 10},
            {"chapterId": 112, "verse_count": 10},
            {"chapterId": 113, "verse_count": 9},
            {"chapterId": 114, "verse_count": 8},
            {"chapterId": 115, "verse_count": 18},
            {"chapterId": 116, "verse_count": 19},
            {"chapterId": 117, "verse_count": 2},
            {"chapterId": 118, "verse_count": 29},
            {"chapterId": 119, "verse_count": 176},
            {"chapterId": 120, "verse_count": 7},
            {"chapterId": 121, "verse_count": 8},
            {"chapterId": 122, "verse_count": 9},
            {"chapterId": 123, "verse_count": 4},
            {"chapterId": 124, "verse_count": 8},
            {"chapterId": 125, "verse_count": 5},
            {"chapterId": 126, "verse_count": 6},
            {"chapterId": 127, "verse_count": 5},
            {"chapterId": 128, "verse_count": 6},
            {"chapterId": 129, "verse_count": 8},
            {"chapterId": 130, "verse_count": 8},
            {"chapterId": 131, "verse_count": 3},
            {"chapterId": 132, "verse_count": 18},
            {"chapterId": 133, "verse_count": 3},
            {"chapterId": 134, "verse_count": 3},
            {"chapterId": 135, "verse_count": 21},
            {"chapterId": 136, "verse_count": 26},
            {"chapterId": 137, "verse_count": 9},
            {"chapterId": 138, "verse_count": 8},
            {"chapterId": 139, "verse_count": 24},
            {"chapterId": 140, "verse_count": 13},
            {"chapterId": 141, "verse_count": 10},
            {"chapterId": 142, "verse_count": 7},
            {"chapterId": 143, "verse_count": 12},
            {"chapterId": 144, "verse_count": 15},
            {"chapterId": 145, "verse_count": 21},
            {"chapterId": 146, "verse_count": 10},
            {"chapterId": 147, "verse_count": 20},
            {"chapterId": 148, "verse_count": 14},
            {"chapterId": 149, "verse_count": 9},
            {"chapterId": 150, "verse_count": 6}
        ]
    },
    {
        "id": 20, "name": "Ordspråkenes bok", "chapter_count": 31, chapters: [
            {"chapterId": 1, "verse_count": 33},
            {"chapterId": 2, "verse_count": 22},
            {"chapterId": 3, "verse_count": 35},
            {"chapterId": 4, "verse_count": 27},
            {"chapterId": 5, "verse_count": 23},
            {"chapterId": 6, "verse_count": 35},
            {"chapterId": 7, "verse_count": 27},
            {"chapterId": 8, "verse_count": 36},
            {"chapterId": 9, "verse_count": 18},
            {"chapterId": 10, "verse_count": 32},
            {"chapterId": 11, "verse_count": 31},
            {"chapterId": 12, "verse_count": 28},
            {"chapterId": 13, "verse_count": 25},
            {"chapterId": 14, "verse_count": 35},
            {"chapterId": 15, "verse_count": 33},
            {"chapterId": 16, "verse_count": 33},
            {"chapterId": 17, "verse_count": 28},
            {"chapterId": 18, "verse_count": 24},
            {"chapterId": 19, "verse_count": 29},
            {"chapterId": 20, "verse_count": 30},
            {"chapterId": 21, "verse_count": 31},
            {"chapterId": 22, "verse_count": 29},
            {"chapterId": 23, "verse_count": 35},
            {"chapterId": 24, "verse_count": 34},
            {"chapterId": 25, "verse_count": 28},
            {"chapterId": 26, "verse_count": 28},
            {"chapterId": 27, "verse_count": 27},
            {"chapterId": 28, "verse_count": 28},
            {"chapterId": 29, "verse_count": 27},
            {"chapterId": 30, "verse_count": 33},
            {"chapterId": 31, "verse_count": 31}
        ]
    },
    {
        "id": 21, "name": "Forkynnerens bok", "chapter_count": 12, chapters: [
            {"chapterId": 1, "verse_count": 18},
            {"chapterId": 2, "verse_count": 26},
            {"chapterId": 3, "verse_count": 22},
            {"chapterId": 4, "verse_count": 16},
            {"chapterId": 5, "verse_count": 20},
            {"chapterId": 6, "verse_count": 12},
            {"chapterId": 7, "verse_count": 29},
            {"chapterId": 8, "verse_count": 17},
            {"chapterId": 9, "verse_count": 18},
            {"chapterId": 10, "verse_count": 20},
            {"chapterId": 11, "verse_count": 10},
            {"chapterId": 12, "verse_count": 14}
        ]
    },
    {
        "id": 22, "name": "Høysangen", "chapter_count": 8, chapters: [
            {"chapterId": 1, "verse_count": 17},
            {"chapterId": 2, "verse_count": 17},
            {"chapterId": 3, "verse_count": 11},
            {"chapterId": 4, "verse_count": 16},
            {"chapterId": 5, "verse_count": 16},
            {"chapterId": 6, "verse_count": 13},
            {"chapterId": 7, "verse_count": 13},
            {"chapterId": 8, "verse_count": 14}
        ]
    },
    {
        "id": 23, "name": "Jesajas bok", "chapter_count": 66, chapters: [
            {"chapterId": 1, "verse_count": 31},
            {"chapterId": 2, "verse_count": 22},
            {"chapterId": 3, "verse_count": 26},
            {"chapterId": 4, "verse_count": 6},
            {"chapterId": 5, "verse_count": 30},
            {"chapterId": 6, "verse_count": 13},
            {"chapterId": 7, "verse_count": 25},
            {"chapterId": 8, "verse_count": 22},
            {"chapterId": 9, "verse_count": 21},
            {"chapterId": 10, "verse_count": 34},
            {"chapterId": 11, "verse_count": 16},
            {"chapterId": 12, "verse_count": 6},
            {"chapterId": 13, "verse_count": 22},
            {"chapterId": 14, "verse_count": 32},
            {"chapterId": 15, "verse_count": 9},
            {"chapterId": 16, "verse_count": 14},
            {"chapterId": 17, "verse_count": 14},
            {"chapterId": 18, "verse_count": 7},
            {"chapterId": 19, "verse_count": 25},
            {"chapterId": 20, "verse_count": 6},
            {"chapterId": 21, "verse_count": 17},
            {"chapterId": 22, "verse_count": 25},
            {"chapterId": 23, "verse_count": 18},
            {"chapterId": 24, "verse_count": 23},
            {"chapterId": 25, "verse_count": 12},
            {"chapterId": 26, "verse_count": 21},
            {"chapterId": 27, "verse_count": 13},
            {"chapterId": 28, "verse_count": 29},
            {"chapterId": 29, "verse_count": 24},
            {"chapterId": 30, "verse_count": 33},
            {"chapterId": 31, "verse_count": 9},
            {"chapterId": 32, "verse_count": 20},
            {"chapterId": 33, "verse_count": 24},
            {"chapterId": 34, "verse_count": 17},
            {"chapterId": 35, "verse_count": 10},
            {"chapterId": 36, "verse_count": 22},
            {"chapterId": 37, "verse_count": 38},
            {"chapterId": 38, "verse_count": 22},
            {"chapterId": 39, "verse_count": 8},
            {"chapterId": 40, "verse_count": 31},
            {"chapterId": 41, "verse_count": 29},
            {"chapterId": 42, "verse_count": 25},
            {"chapterId": 43, "verse_count": 28},
            {"chapterId": 44, "verse_count": 28},
            {"chapterId": 45, "verse_count": 25},
            {"chapterId": 46, "verse_count": 13},
            {"chapterId": 47, "verse_count": 15},
            {"chapterId": 48, "verse_count": 22},
            {"chapterId": 49, "verse_count": 26},
            {"chapterId": 50, "verse_count": 11},
            {"chapterId": 51, "verse_count": 23},
            {"chapterId": 52, "verse_count": 15},
            {"chapterId": 53, "verse_count": 12},
            {"chapterId": 54, "verse_count": 17},
            {"chapterId": 55, "verse_count": 13},
            {"chapterId": 56, "verse_count": 12},
            {"chapterId": 57, "verse_count": 21},
            {"chapterId": 58, "verse_count": 14},
            {"chapterId": 59, "verse_count": 21},
            {"chapterId": 60, "verse_count": 22},
            {"chapterId": 61, "verse_count": 11},
            {"chapterId": 62, "verse_count": 12},
            {"chapterId": 63, "verse_count": 19},
            {"chapterId": 64, "verse_count": 12},
            {"chapterId": 65, "verse_count": 25},
            {"chapterId": 66, "verse_count": 24}
        ]
    },
    {
        "id": 24, "name": "Jeremias bok", "chapter_count": 52, chapters: [
            {"chapterId": 1, "verse_count": 19},
            {"chapterId": 2, "verse_count": 37},
            {"chapterId": 3, "verse_count": 25},
            {"chapterId": 4, "verse_count": 31},
            {"chapterId": 5, "verse_count": 31},
            {"chapterId": 6, "verse_count": 30},
            {"chapterId": 7, "verse_count": 34},
            {"chapterId": 8, "verse_count": 22},
            {"chapterId": 9, "verse_count": 26},
            {"chapterId": 10, "verse_count": 25},
            {"chapterId": 11, "verse_count": 23},
            {"chapterId": 12, "verse_count": 17},
            {"chapterId": 13, "verse_count": 27},
            {"chapterId": 14, "verse_count": 22},
            {"chapterId": 15, "verse_count": 21},
            {"chapterId": 16, "verse_count": 21},
            {"chapterId": 17, "verse_count": 27},
            {"chapterId": 18, "verse_count": 23},
            {"chapterId": 19, "verse_count": 15},
            {"chapterId": 20, "verse_count": 18},
            {"chapterId": 21, "verse_count": 14},
            {"chapterId": 22, "verse_count": 30},
            {"chapterId": 23, "verse_count": 40},
            {"chapterId": 24, "verse_count": 10},
            {"chapterId": 25, "verse_count": 38},
            {"chapterId": 26, "verse_count": 24},
            {"chapterId": 27, "verse_count": 22},
            {"chapterId": 28, "verse_count": 17},
            {"chapterId": 29, "verse_count": 32},
            {"chapterId": 30, "verse_count": 24},
            {"chapterId": 31, "verse_count": 40},
            {"chapterId": 32, "verse_count": 44},
            {"chapterId": 33, "verse_count": 26},
            {"chapterId": 34, "verse_count": 22},
            {"chapterId": 35, "verse_count": 19},
            {"chapterId": 36, "verse_count": 32},
            {"chapterId": 37, "verse_count": 21},
            {"chapterId": 38, "verse_count": 28},
            {"chapterId": 39, "verse_count": 18},
            {"chapterId": 40, "verse_count": 16},
            {"chapterId": 41, "verse_count": 18},
            {"chapterId": 42, "verse_count": 22},
            {"chapterId": 43, "verse_count": 13},
            {"chapterId": 44, "verse_count": 30},
            {"chapterId": 45, "verse_count": 5},
            {"chapterId": 46, "verse_count": 28},
            {"chapterId": 47, "verse_count": 7},
            {"chapterId": 48, "verse_count": 47},
            {"chapterId": 49, "verse_count": 39},
            {"chapterId": 50, "verse_count": 46},
            {"chapterId": 51, "verse_count": 64},
            {"chapterId": 52, "verse_count": 34}
        ]
    },
    {
        "id": 25, "name": "Klagesangene", "chapter_count": 5, chapters: [
            {"chapterId": 1, "verse_count": 22},
            {"chapterId": 2, "verse_count": 22},
            {"chapterId": 3, "verse_count": 66},
            {"chapterId": 4, "verse_count": 22},
            {"chapterId": 5, "verse_count": 22}
        ]
    },
    {
        "id": 26, "name": "Esekiels bok", "chapter_count": 48, chapters: [
            {"chapterId": 1, "verse_count": 28},
            {"chapterId": 2, "verse_count": 10},
            {"chapterId": 3, "verse_count": 27},
            {"chapterId": 4, "verse_count": 17},
            {"chapterId": 5, "verse_count": 17},
            {"chapterId": 6, "verse_count": 14},
            {"chapterId": 7, "verse_count": 27},
            {"chapterId": 8, "verse_count": 18},
            {"chapterId": 9, "verse_count": 11},
            {"chapterId": 10, "verse_count": 22},
            {"chapterId": 11, "verse_count": 25},
            {"chapterId": 12, "verse_count": 28},
            {"chapterId": 13, "verse_count": 23},
            {"chapterId": 14, "verse_count": 23},
            {"chapterId": 15, "verse_count": 8},
            {"chapterId": 16, "verse_count": 63},
            {"chapterId": 17, "verse_count": 24},
            {"chapterId": 18, "verse_count": 32},
            {"chapterId": 19, "verse_count": 14},
            {"chapterId": 20, "verse_count": 49},
            {"chapterId": 21, "verse_count": 32},
            {"chapterId": 22, "verse_count": 31},
            {"chapterId": 23, "verse_count": 49},
            {"chapterId": 24, "verse_count": 27},
            {"chapterId": 25, "verse_count": 17},
            {"chapterId": 26, "verse_count": 21},
            {"chapterId": 27, "verse_count": 36},
            {"chapterId": 28, "verse_count": 26},
            {"chapterId": 29, "verse_count": 21},
            {"chapterId": 30, "verse_count": 26},
            {"chapterId": 31, "verse_count": 18},
            {"chapterId": 32, "verse_count": 32},
            {"chapterId": 33, "verse_count": 33},
            {"chapterId": 34, "verse_count": 31},
            {"chapterId": 35, "verse_count": 15},
            {"chapterId": 36, "verse_count": 38},
            {"chapterId": 37, "verse_count": 28},
            {"chapterId": 38, "verse_count": 23},
            {"chapterId": 39, "verse_count": 29},
            {"chapterId": 40, "verse_count": 49},
            {"chapterId": 41, "verse_count": 26},
            {"chapterId": 42, "verse_count": 20},
            {"chapterId": 43, "verse_count": 27},
            {"chapterId": 44, "verse_count": 31},
            {"chapterId": 45, "verse_count": 25},
            {"chapterId": 46, "verse_count": 24},
            {"chapterId": 47, "verse_count": 23},
            {"chapterId": 48, "verse_count": 35}
        ]
    },
    {
        "id": 27, "name": "Daniels bok", "chapter_count": 12, chapters: [
            {"chapterId": 1, "verse_count": 21},
            {"chapterId": 2, "verse_count": 49},
            {"chapterId": 3, "verse_count": 30},
            {"chapterId": 4, "verse_count": 37},
            {"chapterId": 5, "verse_count": 31},
            {"chapterId": 6, "verse_count": 28},
            {"chapterId": 7, "verse_count": 28},
            {"chapterId": 8, "verse_count": 27},
            {"chapterId": 9, "verse_count": 27},
            {"chapterId": 10, "verse_count": 21},
            {"chapterId": 11, "verse_count": 45},
            {"chapterId": 12, "verse_count": 13}
        ]
    },
    {
        "id": 28, "name": "Hoseas bok", "chapter_count": 14, chapters: [
            {"chapterId": 1, "verse_count": 11},
            {"chapterId": 2, "verse_count": 23},
            {"chapterId": 3, "verse_count": 5},
            {"chapterId": 4, "verse_count": 19},
            {"chapterId": 5, "verse_count": 15},
            {"chapterId": 6, "verse_count": 11},
            {"chapterId": 7, "verse_count": 16},
            {"chapterId": 8, "verse_count": 14},
            {"chapterId": 9, "verse_count": 17},
            {"chapterId": 10, "verse_count": 15},
            {"chapterId": 11, "verse_count": 12},
            {"chapterId": 12, "verse_count": 14},
            {"chapterId": 13, "verse_count": 16},
            {"chapterId": 14, "verse_count": 9}
        ]
    },
    {
        "id": 29, "name": "Joels bok", "chapter_count": 3, chapters: [
            {"chapterId": 1, "verse_count": 20},
            {"chapterId": 2, "verse_count": 32},
            {"chapterId": 3, "verse_count": 21}
        ]
    },
    {
        "id": 30, "name": "Amos' bok", "chapter_count": 9, chapters: [
            {"chapterId": 1, "verse_count": 15},
            {"chapterId": 2, "verse_count": 16},
            {"chapterId": 3, "verse_count": 15},
            {"chapterId": 4, "verse_count": 13},
            {"chapterId": 5, "verse_count": 27},
            {"chapterId": 6, "verse_count": 14},
            {"chapterId": 7, "verse_count": 17},
            {"chapterId": 8, "verse_count": 14},
            {"chapterId": 9, "verse_count": 15}
        ]
    },
    {
        "id": 31, "name": "Obadjas bok", "chapter_count": 1, chapters: [
            {"chapterId": 1, "verse_count": 21}
        ]
    },
    {
        "id": 32, "name": "Jonas' bok", "chapter_count": 4, chapters: [
            {"chapterId": 1, "verse_count": 17},
            {"chapterId": 2, "verse_count": 10},
            {"chapterId": 3, "verse_count": 10},
            {"chapterId": 4, "verse_count": 11}
        ]
    },
    {
        "id": 33, "name": "Mikas bok", "chapter_count": 7, chapters: [
            {"chapterId": 1, "verse_count": 16},
            {"chapterId": 2, "verse_count": 13},
            {"chapterId": 3, "verse_count": 12},
            {"chapterId": 4, "verse_count": 13},
            {"chapterId": 5, "verse_count": 15},
            {"chapterId": 6, "verse_count": 16},
            {"chapterId": 7, "verse_count": 20}
        ]
    },
    {
        "id": 34, "name": "Nahums bok", "chapter_count": 3, chapters: [
            {"chapterId": 1, "verse_count": 15},
            {"chapterId": 2, "verse_count": 13},
            {"chapterId": 3, "verse_count": 19}
        ]
    },
    {
        "id": 35, "name": "Habakkuks bok", "chapter_count": 3, chapters: [
            {"chapterId": 1, "verse_count": 17},
            {"chapterId": 2, "verse_count": 20},
            {"chapterId": 3, "verse_count": 19}
        ]
    },
    {
        "id": 36, "name": "Sefanjas bok", "chapter_count": 3, chapters: [
            {"chapterId": 1, "verse_count": 18},
            {"chapterId": 2, "verse_count": 15},
            {"chapterId": 3, "verse_count": 20}
        ]
    },
    {
        "id": 37, "name": "Haggais bok", "chapter_count": 2, chapters: [
            {"chapterId": 1, "verse_count": 15},
            {"chapterId": 2, "verse_count": 23}
        ]
    },
    {
        "id": 38, "name": "Sakarjas bok", "chapter_count": 14, chapters: [
            {"chapterId": 1, "verse_count": 21},
            {"chapterId": 2, "verse_count": 13},
            {"chapterId": 3, "verse_count": 10},
            {"chapterId": 4, "verse_count": 14},
            {"chapterId": 5, "verse_count": 11},
            {"chapterId": 6, "verse_count": 15},
            {"chapterId": 7, "verse_count": 14},
            {"chapterId": 8, "verse_count": 23},
            {"chapterId": 9, "verse_count": 17},
            {"chapterId": 10, "verse_count": 12},
            {"chapterId": 11, "verse_count": 17},
            {"chapterId": 12, "verse_count": 14},
            {"chapterId": 13, "verse_count": 9},
            {"chapterId": 14, "verse_count": 21}
        ]
    },
    {
        "id": 39, "name": "Malakis bok", "chapter_count": 4, chapters: [
            {"chapterId": 1, "verse_count": 14},
            {"chapterId": 2, "verse_count": 17},
            {"chapterId": 3, "verse_count": 18},
            {"chapterId": 4, "verse_count": 6}
        ]
    },
    {
        "id": 40,
        "name": "Matteus' evangelium",
        "chapter_count": 28,
        chapters: [
            {"chapterId": 1, "verse_count": 25},
            {"chapterId": 2, "verse_count": 23},
            {"chapterId": 3, "verse_count": 17},
            {"chapterId": 4, "verse_count": 25},
            {"chapterId": 5, "verse_count": 48},
            {"chapterId": 6, "verse_count": 34},
            {"chapterId": 7, "verse_count": 29},
            {"chapterId": 8, "verse_count": 34},
            {"chapterId": 9, "verse_count": 38},
            {"chapterId": 10, "verse_count": 42},
            {"chapterId": 11, "verse_count": 30},
            {"chapterId": 12, "verse_count": 50},
            {"chapterId": 13, "verse_count": 58},
            {"chapterId": 14, "verse_count": 36},
            {"chapterId": 15, "verse_count": 39},
            {"chapterId": 16, "verse_count": 28},
            {"chapterId": 17, "verse_count": 27},
            {"chapterId": 18, "verse_count": 35},
            {"chapterId": 19, "verse_count": 30},
            {"chapterId": 20, "verse_count": 34},
            {"chapterId": 21, "verse_count": 46},
            {"chapterId": 22, "verse_count": 46},
            {"chapterId": 23, "verse_count": 39},
            {"chapterId": 24, "verse_count": 51},
            {"chapterId": 25, "verse_count": 46},
            {"chapterId": 26, "verse_count": 75},
            {"chapterId": 27, "verse_count": 66},
            {"chapterId": 28, "verse_count": 20}
        ]
    },
    {
        "id": 41,
        "name": "Markus' evangelium",
        "chapter_count": 16,
        chapters: [
            {"chapterId": 1, "verse_count": 45},
            {"chapterId": 2, "verse_count": 28},
            {"chapterId": 3, "verse_count": 35},
            {"chapterId": 4, "verse_count": 41},
            {"chapterId": 5, "verse_count": 43},
            {"chapterId": 6, "verse_count": 56},
            {"chapterId": 7, "verse_count": 37},
            {"chapterId": 8, "verse_count": 38},
            {"chapterId": 9, "verse_count": 50},
            {"chapterId": 10, "verse_count": 52},
            {"chapterId": 11, "verse_count": 33},
            {"chapterId": 12, "verse_count": 44},
            {"chapterId": 13, "verse_count": 37},
            {"chapterId": 14, "verse_count": 72},
            {"chapterId": 15, "verse_count": 47},
            {"chapterId": 16, "verse_count": 20}
        ]
    },
    {
        "id": 42, "name": "Lukas' evangelium", "chapter_count": 24, chapters: [
            {"chapterId": 1, "verse_count": 80},
            {"chapterId": 2, "verse_count": 52},
            {"chapterId": 3, "verse_count": 38},
            {"chapterId": 4, "verse_count": 44},
            {"chapterId": 5, "verse_count": 39},
            {"chapterId": 6, "verse_count": 49},
            {"chapterId": 7, "verse_count": 50},
            {"chapterId": 8, "verse_count": 56},
            {"chapterId": 9, "verse_count": 62},
            {"chapterId": 10, "verse_count": 42},
            {"chapterId": 11, "verse_count": 54},
            {"chapterId": 12, "verse_count": 59},
            {"chapterId": 13, "verse_count": 35},
            {"chapterId": 14, "verse_count": 35},
            {"chapterId": 15, "verse_count": 32},
            {"chapterId": 16, "verse_count": 31},
            {"chapterId": 17, "verse_count": 37},
            {"chapterId": 18, "verse_count": 43},
            {"chapterId": 19, "verse_count": 48},
            {"chapterId": 20, "verse_count": 47},
            {"chapterId": 21, "verse_count": 38},
            {"chapterId": 22, "verse_count": 71},
            {"chapterId": 23, "verse_count": 56},
            {"chapterId": 24, "verse_count": 53}
        ]
    },
    {
        "id": 43, "name": "Johannes' evangelium", "chapter_count": 21, chapters: [
            {"chapterId": 1, "verse_count": 51},
            {"chapterId": 2, "verse_count": 25},
            {"chapterId": 3, "verse_count": 36},
            {"chapterId": 4, "verse_count": 54},
            {"chapterId": 5, "verse_count": 47},
            {"chapterId": 6, "verse_count": 71},
            {"chapterId": 7, "verse_count": 53},
            {"chapterId": 8, "verse_count": 59},
            {"chapterId": 9, "verse_count": 41},
            {"chapterId": 10, "verse_count": 42},
            {"chapterId": 11, "verse_count": 57},
            {"chapterId": 12, "verse_count": 50},
            {"chapterId": 13, "verse_count": 38},
            {"chapterId": 14, "verse_count": 31},
            {"chapterId": 15, "verse_count": 27},
            {"chapterId": 16, "verse_count": 33},
            {"chapterId": 17, "verse_count": 26},
            {"chapterId": 18, "verse_count": 40},
            {"chapterId": 19, "verse_count": 42},
            {"chapterId": 20, "verse_count": 31},
            {"chapterId": 21, "verse_count": 25}
        ]
    },
    {
        "id": 44, "name": "Apostlenes gjerninger", "chapter_count": 28, chapters: [
            {"chapterId": 1, "verse_count": 26},
            {"chapterId": 2, "verse_count": 47},
            {"chapterId": 3, "verse_count": 26},
            {"chapterId": 4, "verse_count": 37},
            {"chapterId": 5, "verse_count": 42},
            {"chapterId": 6, "verse_count": 15},
            {"chapterId": 7, "verse_count": 60},
            {"chapterId": 8, "verse_count": 40},
            {"chapterId": 9, "verse_count": 43},
            {"chapterId": 10, "verse_count": 48},
            {"chapterId": 11, "verse_count": 30},
            {"chapterId": 12, "verse_count": 25},
            {"chapterId": 13, "verse_count": 52},
            {"chapterId": 14, "verse_count": 28},
            {"chapterId": 15, "verse_count": 41},
            {"chapterId": 16, "verse_count": 40},
            {"chapterId": 17, "verse_count": 34},
            {"chapterId": 18, "verse_count": 28},
            {"chapterId": 19, "verse_count": 41},
            {"chapterId": 20, "verse_count": 38},
            {"chapterId": 21, "verse_count": 40},
            {"chapterId": 22, "verse_count": 30},
            {"chapterId": 23, "verse_count": 35},
            {"chapterId": 24, "verse_count": 27},
            {"chapterId": 25, "verse_count": 27},
            {"chapterId": 26, "verse_count": 32},
            {"chapterId": 27, "verse_count": 44},
            {"chapterId": 28, "verse_count": 31}
        ]
    },
    {
        "id": 45, "name": "Paulus' brev til romerne", "chapter_count": 16, chapters: [
            {"chapterId": 1, "verse_count": 32},
            {"chapterId": 2, "verse_count": 29},
            {"chapterId": 3, "verse_count": 31},
            {"chapterId": 4, "verse_count": 25},
            {"chapterId": 5, "verse_count": 21},
            {"chapterId": 6, "verse_count": 23},
            {"chapterId": 7, "verse_count": 25},
            {"chapterId": 8, "verse_count": 39},
            {"chapterId": 9, "verse_count": 33},
            {"chapterId": 10, "verse_count": 21},
            {"chapterId": 11, "verse_count": 36},
            {"chapterId": 12, "verse_count": 21},
            {"chapterId": 13, "verse_count": 14},
            {"chapterId": 14, "verse_count": 23},
            {"chapterId": 15, "verse_count": 33},
            {"chapterId": 16, "verse_count": 27}
        ]
    },
    {
        "id": 46, "name": "Første Korinterbrev", "chapter_count": 16, chapters: [
            {"chapterId": 1, "verse_count": 31},
            {"chapterId": 2, "verse_count": 16},
            {"chapterId": 3, "verse_count": 23},
            {"chapterId": 4, "verse_count": 21},
            {"chapterId": 5, "verse_count": 13},
            {"chapterId": 6, "verse_count": 20},
            {"chapterId": 7, "verse_count": 40},
            {"chapterId": 8, "verse_count": 13},
            {"chapterId": 9, "verse_count": 27},
            {"chapterId": 10, "verse_count": 33},
            {"chapterId": 11, "verse_count": 34},
            {"chapterId": 12, "verse_count": 31},
            {"chapterId": 13, "verse_count": 13},
            {"chapterId": 14, "verse_count": 40},
            {"chapterId": 15, "verse_count": 58},
            {"chapterId": 16, "verse_count": 24}
        ]
    },
    {
        "id": 47,
        "name": "Andre Korinterbrev",
        "chapter_count": 13,
        chapters: [
            {"chapterId": 1, "verse_count": 24},
            {"chapterId": 2, "verse_count": 17},
            {"chapterId": 3, "verse_count": 18},
            {"chapterId": 4, "verse_count": 18},
            {"chapterId": 5, "verse_count": 21},
            {"chapterId": 6, "verse_count": 18},
            {"chapterId": 7, "verse_count": 16},
            {"chapterId": 8, "verse_count": 24},
            {"chapterId": 9, "verse_count": 15},
            {"chapterId": 10, "verse_count": 18},
            {"chapterId": 11, "verse_count": 33},
            {"chapterId": 12, "verse_count": 21},
            {"chapterId": 13, "verse_count": 14}
        ]
    }
    ,
    {
        "id":
            48, "name":
            "Galaterbrevet", "chapter_count":
            6,
        chapters: [
            {"chapterId": 1, "verse_count": 24},
            {"chapterId": 2, "verse_count": 21},
            {"chapterId": 3, "verse_count": 29},
            {"chapterId": 4, "verse_count": 31},
            {"chapterId": 5, "verse_count": 26},
            {"chapterId": 6, "verse_count": 18}
        ]
    }
    ,
    {
        "id":
            49, "name":
            "Efeserbrevet", "chapter_count":
            6,
        chapters: [
            {"chapterId": 1, "verse_count": 23},
            {"chapterId": 2, "verse_count": 22},
            {"chapterId": 3, "verse_count": 21},
            {"chapterId": 4, "verse_count": 32},
            {"chapterId": 5, "verse_count": 33},
            {"chapterId": 6, "verse_count": 24}
        ]
    }
    ,
    {
        "id":
            50, "name":
            "Filipperbrevet", "chapter_count":
            4,
        chapters: [
            {"chapterId": 1, "verse_count": 30},
            {"chapterId": 2, "verse_count": 30},
            {"chapterId": 3, "verse_count": 21},
            {"chapterId": 4, "verse_count": 23}
        ]
    }
    ,
    {
        "id":
            51, "name":
            "Kolosserbrevet", "chapter_count":
            4,
        chapters: [
            {"chapterId": 1, "verse_count": 29},
            {"chapterId": 2, "verse_count": 23},
            {"chapterId": 3, "verse_count": 25},
            {"chapterId": 4, "verse_count": 18}
        ]
    }
    ,
    {
        "id":
            52, "name":
            "Første Tessalonikerbrev", "chapter_count":
            5,
        chapters: [
            {"chapterId": 1, "verse_count": 10},
            {"chapterId": 2, "verse_count": 20},
            {"chapterId": 3, "verse_count": 13},
            {"chapterId": 4, "verse_count": 18},
            {"chapterId": 5, "verse_count": 28}
        ]
    }
    ,
    {
        "id":
            53, "name":
            "Andre Tessalonikerbrev", "chapter_count":
            3,
        chapters: [
            {"chapterId": 1, "verse_count": 12},
            {"chapterId": 2, "verse_count": 17},
            {"chapterId": 3, "verse_count": 18}
        ]
    }
    ,
    {
        "id":
            54, "name":
            "Første Timoteusbrev", "chapter_count":
            6,
        chapters: [
            {"chapterId": 1, "verse_count": 20},
            {"chapterId": 2, "verse_count": 15},
            {"chapterId": 3, "verse_count": 16},
            {"chapterId": 4, "verse_count": 16},
            {"chapterId": 5, "verse_count": 25},
            {"chapterId": 6, "verse_count": 21}
        ]
    }
    ,
    {
        "id":
            55, "name":
            "Andre Timoteusbrev", "chapter_count":
            4,
        chapters: [
            {"chapterId": 1, "verse_count": 18},
            {"chapterId": 2, "verse_count": 26},
            {"chapterId": 3, "verse_count": 17},
            {"chapterId": 4, "verse_count": 22}
        ]
    }
    ,
    {
        "id":
            56, "name":
            "Titusbrevet", "chapter_count":
            3,
        chapters: [
            {"chapterId": 1, "verse_count": 16},
            {"chapterId": 2, "verse_count": 15},
            {"chapterId": 3, "verse_count": 15}
        ]
    }
    ,
    {
        "id":
            57, "name":
            "Filemonbrevet", "chapter_count":
            1,
        chapters: [
            {"chapterId": 1, "verse_count": 25}
        ]
    }
    ,
    {
        "id":
            58, "name":
            "Hebreerbrevet", "chapter_count":
            13,
        chapters: [
            {"chapterId": 1, "verse_count": 14},
            {"chapterId": 2, "verse_count": 18},
            {"chapterId": 3, "verse_count": 19},
            {"chapterId": 4, "verse_count": 16},
            {"chapterId": 5, "verse_count": 14},
            {"chapterId": 6, "verse_count": 20},
            {"chapterId": 7, "verse_count": 28},
            {"chapterId": 8, "verse_count": 13},
            {"chapterId": 9, "verse_count": 28},
            {"chapterId": 10, "verse_count": 39},
            {"chapterId": 11, "verse_count": 40},
            {"chapterId": 12, "verse_count": 29},
            {"chapterId": 13, "verse_count": 25}
        ]
    }
    ,
    {
        "id":
            59, "name":
            "Jakobsbrevet", "chapter_count":
            5,
        chapters: [
            {"chapterId": 1, "verse_count": 27},
            {"chapterId": 2, "verse_count": 26},
            {"chapterId": 3, "verse_count": 18},
            {"chapterId": 4, "verse_count": 17},
            {"chapterId": 5, "verse_count": 20}
        ]
    }
    ,
    {
        "id":
            60, "name":
            "Første Petersbrev", "chapter_count":
            5,
        chapters: [
            {"chapterId": 1, "verse_count": 25},
            {"chapterId": 2, "verse_count": 25},
            {"chapterId": 3, "verse_count": 22},
            {"chapterId": 4, "verse_count": 19},
            {"chapterId": 5, "verse_count": 14}
        ]
    }
    ,
    {
        "id":
            61, "name":
            "Andre Petersbrev", "chapter_count":
            3,
        chapters: [
            {"chapterId": 1, "verse_count": 21},
            {"chapterId": 2, "verse_count": 22},
            {"chapterId": 3, "verse_count": 18}
        ]
    }
    ,
    {
        "id":
            62, "name":
            "Første Johannesbrev", "chapter_count":
            5,
        chapters: [
            {"chapterId": 1, "verse_count": 10},
            {"chapterId": 2, "verse_count": 29},
            {"chapterId": 3, "verse_count": 24},
            {"chapterId": 4, "verse_count": 21},
            {"chapterId": 5, "verse_count": 21}
        ]
    }
    ,
    {
        "id":
            63, "name":
            "Andre Johannesbrev", "chapter_count":
            1,
        chapters: [
            {"chapterId": 1, "verse_count": 13}
        ]
    }
    ,
    {
        "id":
            64, "name":
            "Tredje Johannesbrev", "chapter_count":
            1,
        chapters: [
            {"chapterId": 1, "verse_count": 14}
        ]

    }
    ,
    {
        "id":
            65, "name":
            "Judasbrevet", "chapter_count":
            1,
        chapters: [
            {"chapterId": 1, "verse_count": 25}
        ]
    }
    ,
    {
        "id":
            66, "name":
            "Johannes' åpenbaring", "chapter_count":
            22,
        chapters: [
            {"chapterId": 1, "verse_count": 20},
            {"chapterId": 2, "verse_count": 29},
            {"chapterId": 3, "verse_count": 22},
            {"chapterId": 4, "verse_count": 11},
            {"chapterId": 5, "verse_count": 14},
            {"chapterId": 6, "verse_count": 17},
            {"chapterId": 7, "verse_count": 17},
            {"chapterId": 8, "verse_count": 13},
            {"chapterId": 9, "verse_count": 21},
            {"chapterId": 10, "verse_count": 11},
            {"chapterId": 11, "verse_count": 19},
            {"chapterId": 12, "verse_count": 17},
            {"chapterId": 13, "verse_count": 18},
            {"chapterId": 14, "verse_count": 20},
            {"chapterId": 15, "verse_count": 8},
            {"chapterId": 16, "verse_count": 21},
            {"chapterId": 17, "verse_count": 18},
            {"chapterId": 18, "verse_count": 24},
            {"chapterId": 19, "verse_count": 21},
            {"chapterId": 20, "verse_count": 15},
            {"chapterId": 21, "verse_count": 27},
            {"chapterId": 22, "verse_count": 21}
        ]
    }
]


async function doBook(translation, bookNr = 1, chapter = 1) {

    console.log("Starting up with parameters", bookNr, chapter);
    while (bookNr <= 66) {
        let book = books.find(b => b.id === bookNr).name;
        do {
            API = new ChatGPTAPI({
                apiKey: process.env.OPENAI_API_KEY,
                completionParams: {
                    model: 'gpt-4',
                    temperature: 0.5,
                    top_p: 0.8
                }
            })
            await translate(translation, translations[translation].long, bookNr, chapter, `${book} ${chapter++}`)
        } while (chapter <= books.find(b => b.name === book).chapter_count)
        bookNr++;
        chapter = 1;
    }
}

const ask = async (text, prevRes = {}) => {
    console.log(`--> ASKING ${text}`);
    prevRes.timeoutMs = 10 * 60 * 1000;
    return await API.sendMessage(text, prevRes);
}
const translate = async (translation, bible_long, bookNr, chapter, bibleRef) => {
    let res = null;
    do {
        try {
            res = await ask(`Lag et sammendrag av ${bibleRef} på norsk, bokmål.
Når du er ferdig, skriv: FERDIG`);
        } catch (e) {
            console.log("Catching initial", e)
        }
    } while (!res)
    await store(translation, bookNr, chapter, res.text.replace("FINISHED", "").replace("FERDIG", ""));
    while (!res.text.includes("FINISHED") && !res.text.includes("FERDIG")) {
        try {
            res = await ask(`continue`, {
                parentMessageId: res.id
            })
        } catch (e) {
            console.log("Catching followup", e)
        }
        await store(translation, bookNr, chapter, res.text.replace("FINISHED", "").replace("FERDIG", ""));
    }
}

const store = async (translation, bookNr, chapterNr, text) => {
    fs.appendFileSync(`summaries/${translations[translation].language}/${bookNr}-${chapterNr}.txt`,
        text
    );
    console.log("==> SAVED");
}

const args = process.argv.slice(2);
if (args.length !== 3)
    console.error("Wrong params: <translation> <bookId> <chapterId>");

await doBook(args[0], +args[1], +args[2]);