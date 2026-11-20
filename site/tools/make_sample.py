"""Builds sample market data for working on the website without the live bucket.

Fake scans for ~10 days go through the real hourly job (jobs/process.py), so the files in
site/sample/out/ have exactly the shape the live site will read. Prices, names and icons are
made up or from memory: good enough to build against, not facts.

    python site/tools/make_sample.py            writes site/sample/out/ and site/sample/stress/
"""
import gzip
import json
import math
import random
import shutil
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "jobs"))
import process  # noqa: E402
from store import LocalStore  # noqa: E402

H = 3600
END = 1793818800            # 2026-11-04 19:00 UTC, last scanned hour
DAYS = 10
OUT = ROOT / "site" / "sample"

# id, enUS, deDE, quality, class, subclass, ilvl, req, stack, icon, base price (copper/unit), typical units, trend
# trend: per-day drift (0.03 = +3 %/day), or a named shape
ITEMS = [
    # cloth 7/5
    (2589, "Linen Cloth", "Leinenstoff", 1, 7, 5, 5, 0, 200, "inv_fabric_linen_01", 45, 5200, -0.01),
    (2592, "Wool Cloth", "Wollstoff", 1, 7, 5, 15, 0, 200, "inv_fabric_wool_01", 70, 3800, 0.0),
    (4306, "Silk Cloth", "Seidenstoff", 1, 7, 5, 25, 0, 200, "inv_fabric_silk_01", 140, 3100, 0.01),
    (4338, "Mageweave Cloth", "Magiestoff", 1, 7, 5, 40, 0, 200, "inv_fabric_mageweave_01", 260, 2700, 0.02),
    (14047, "Runecloth", "Runenstoff", 1, 7, 5, 50, 0, 200, "inv_fabric_purple_01", 420, 2400, 0.04),
    (14256, "Felcloth", "Teufelsstoff", 2, 7, 5, 55, 0, 200, "inv_fabric_felcloth_ebon", 9500, 40, 0.0),
    (2996, "Bolt of Linen Cloth", "Leinenstoffballen", 1, 7, 5, 10, 0, 200, "inv_fabric_linen_02", 160, 300, 0.0),
    (2997, "Bolt of Woolen Cloth", "Wollstoffballen", 1, 7, 5, 20, 0, 200, "inv_fabric_wool_02", 320, 220, 0.0),
    (4305, "Bolt of Silk Cloth", "Seidenstoffballen", 1, 7, 5, 35, 0, 200, "inv_fabric_silk_02", 700, 180, 0.01),
    (4339, "Bolt of Mageweave", "Magiestoffballen", 1, 7, 5, 45, 0, 200, "inv_fabric_mageweave_02", 1300, 150, 0.0),
    (14048, "Bolt of Runecloth", "Runenstoffballen", 1, 7, 5, 55, 0, 200, "inv_fabric_purple_02", 2600, 120, 0.03),
    (14227, "Ironweb Spider Silk", "Eisenspinnenseide", 1, 7, 5, 50, 0, 200, "inv_misc_thread_01", 1400, 90, 0.0),
    # leather 7/6
    (2318, "Light Leather", "Leichtes Leder", 1, 7, 6, 10, 0, 200, "inv_misc_leatherscrap_03", 55, 2600, 0.0),
    (2319, "Medium Leather", "Mittleres Leder", 1, 7, 6, 20, 0, 200, "inv_misc_leatherscrap_05", 120, 1900, 0.0),
    (4234, "Heavy Leather", "Schweres Leder", 1, 7, 6, 30, 0, 200, "inv_misc_leatherscrap_07", 230, 1500, 0.01),
    (4304, "Thick Leather", "Dickes Leder", 1, 7, 6, 40, 0, 200, "inv_misc_leatherscrap_08", 410, 1300, 0.0),
    (8170, "Rugged Leather", "Unverwüstliches Leder", 1, 7, 6, 50, 0, 200, "inv_misc_leatherscrap_02", 560, 1600, 0.02),
    (783, "Light Hide", "Leichter Balg", 1, 7, 6, 10, 0, 20, "inv_misc_pelt_wolf_ruin_02", 220, 180, 0.0),
    (4232, "Medium Hide", "Mittlerer Balg", 1, 7, 6, 20, 0, 20, "inv_misc_pelt_wolf_ruin_01", 380, 140, 0.0),
    (4235, "Heavy Hide", "Schwerer Balg", 1, 7, 6, 30, 0, 20, "inv_misc_pelt_wolf_01", 650, 110, 0.0),
    (8171, "Rugged Hide", "Unverwüstlicher Balg", 1, 7, 6, 50, 0, 20, "inv_misc_pelt_bear_03", 2300, 70, 0.0),
    (15417, "Devilsaur Leather", "Teufelsaurierleder", 1, 7, 6, 55, 0, 20, "inv_misc_leatherscrap_02", 48000, 25, "spike"),
    # metal & stone 7/7
    (2770, "Copper Ore", "Kupfererz", 1, 7, 7, 5, 0, 20, "inv_ore_copper_01", 60, 3400, -0.04),
    (2771, "Tin Ore", "Zinnerz", 1, 7, 7, 15, 0, 20, "inv_ore_tin_01", 95, 2100, -0.01),
    (2772, "Iron Ore", "Eisenerz", 1, 7, 7, 25, 0, 20, "inv_ore_iron_01", 210, 1700, 0.0),
    (2775, "Silver Ore", "Silbererz", 2, 7, 7, 20, 0, 20, "inv_stone_16", 450, 60, 0.0),
    (2776, "Gold Ore", "Golderz", 2, 7, 7, 30, 0, 20, "inv_ore_copper_01", 900, 80, 0.0),
    (3858, "Mithril Ore", "Mithrilerz", 1, 7, 7, 40, 0, 20, "inv_ore_mithril_02", 380, 1500, 0.01),
    (7911, "Truesilver Ore", "Echtsilbererz", 2, 7, 7, 40, 0, 20, "inv_ore_truesilver_01", 1900, 120, 0.0),
    (10620, "Thorium Ore", "Thoriumerz", 1, 7, 7, 50, 0, 20, "inv_ore_thorium_02", 700, 2000, 0.02),
    (2840, "Copper Bar", "Kupferbarren", 1, 7, 7, 10, 0, 20, "inv_ingot_02", 75, 1400, -0.03),
    (3576, "Tin Bar", "Zinnbarren", 1, 7, 7, 20, 0, 20, "inv_ingot_05", 120, 700, 0.0),
    (2841, "Bronze Bar", "Bronzebarren", 1, 7, 7, 20, 0, 20, "inv_ingot_bronze", 210, 600, 0.0),
    (3575, "Iron Bar", "Eisenbarren", 1, 7, 7, 30, 0, 20, "inv_ingot_iron", 260, 800, 0.0),
    (3859, "Steel Bar", "Stahlbarren", 1, 7, 7, 35, 0, 20, "inv_ingot_steel", 380, 300, 0.0),
    (3860, "Mithril Bar", "Mithrilbarren", 1, 7, 7, 40, 0, 20, "inv_ingot_06", 480, 900, 0.01),
    (12359, "Thorium Bar", "Thoriumbarren", 1, 7, 7, 50, 0, 20, "inv_ingot_07", 820, 1100, 0.02),
    (12360, "Arcanite Bar", "Arkanitbarren", 2, 7, 7, 55, 0, 20, "inv_misc_stonetablet_05", 240000, 18, "fall"),
    (2835, "Rough Stone", "Rauer Stein", 1, 7, 7, 5, 0, 20, "inv_stone_04", 30, 1200, 0.0),
    (2838, "Heavy Stone", "Schwerer Stein", 1, 7, 7, 25, 0, 20, "inv_stone_06", 110, 800, 0.0),
    (12365, "Dense Stone", "Verdichteter Stein", 1, 7, 7, 50, 0, 20, "inv_stone_10", 260, 1200, 0.0),
    (12363, "Arcane Crystal", "Arkankristall", 2, 7, 7, 55, 0, 20, "inv_misc_gem_crystal_01", 260000, 9, "fall"),
    # herbs 7/9
    (2447, "Peacebloom", "Friedensblume", 1, 7, 9, 5, 0, 20, "inv_misc_flower_02", 25, 2900, 0.0),
    (765, "Silverleaf", "Silberblatt", 1, 7, 9, 5, 0, 20, "inv_misc_herb_10", 30, 3300, 0.0),
    (785, "Mageroyal", "Maguskönigskraut", 1, 7, 9, 10, 0, 20, "inv_jewelry_talisman_03", 70, 1200, 0.0),
    (2450, "Briarthorn", "Wilddornrose", 1, 7, 9, 15, 0, 20, "inv_misc_root_01", 85, 1500, 0.0),
    (2453, "Bruiseweed", "Beulengras", 1, 7, 9, 20, 0, 20, "inv_misc_herb_01", 110, 900, 0.0),
    (3820, "Stranglekelp", "Würgetang", 1, 7, 9, 25, 0, 20, "inv_misc_herb_11", 120, 700, 0.0),
    (3356, "Kingsblood", "Königsblut", 1, 7, 9, 30, 0, 20, "inv_misc_herb_03", 190, 800, 0.0),
    (3357, "Liferoot", "Lebenswurz", 1, 7, 9, 35, 0, 20, "inv_misc_root_02", 240, 600, 0.0),
    (3818, "Fadeleaf", "Blassblatt", 1, 7, 9, 35, 0, 20, "inv_misc_herb_12", 260, 500, 0.0),
    (3821, "Goldthorn", "Golddorn", 1, 7, 9, 40, 0, 20, "inv_misc_herb_15", 230, 650, 0.0),
    (3358, "Khadgar's Whisker", "Khadgars Schnurrbart", 1, 7, 9, 40, 0, 20, "inv_misc_herb_08", 300, 500, 0.0),
    (8838, "Sungrass", "Sonnengras", 1, 7, 9, 45, 0, 20, "inv_misc_herb_18", 420, 900, 0.01),
    (8839, "Blindweed", "Blindkraut", 1, 7, 9, 45, 0, 20, "inv_misc_herb_14", 300, 400, 0.0),
    (8845, "Ghost Mushroom", "Geisterpilz", 1, 7, 9, 45, 0, 20, "inv_mushroom_08", 900, 120, 0.0),
    (8846, "Gromsblood", "Gromsblut", 1, 7, 9, 50, 0, 20, "inv_misc_herb_16", 650, 450, 0.02),
    (13463, "Dreamfoil", "Traumblatt", 1, 7, 9, 55, 0, 20, "inv_misc_herb_dreamfoil", 900, 700, 0.03),
    (13464, "Golden Sansam", "Goldener Sansam", 1, 7, 9, 55, 0, 20, "inv_misc_herb_sansamroot", 1000, 600, 0.02),
    (13465, "Mountain Silversage", "Bergsilbersalbei", 1, 7, 9, 55, 0, 20, "inv_misc_herb_mountainsilversage", 1800, 400, 0.03),
    (13466, "Plaguebloom", "Pestblüte", 1, 7, 9, 55, 0, 20, "inv_misc_herb_plaguebloom", 1400, 350, 0.01),
    (13467, "Icecap", "Eiskappe", 1, 7, 9, 55, 0, 20, "inv_misc_herb_icecap", 1600, 300, 0.0),
    (13468, "Black Lotus", "Schwarzer Lotus", 2, 7, 9, 60, 0, 20, "inv_misc_herb_blacklotus", 520000, 6, -0.05),
    # enchanting 7/12
    (10940, "Strange Dust", "Seltsamer Staub", 1, 7, 12, 10, 0, 20, "inv_enchant_duststrange", 60, 900, 0.0),
    (11083, "Soul Dust", "Seelenstaub", 1, 7, 12, 25, 0, 20, "inv_enchant_dustsoul", 220, 400, 0.0),
    (11137, "Vision Dust", "Visionenstaub", 1, 7, 12, 35, 0, 20, "inv_enchant_dustvision", 380, 350, 0.0),
    (11176, "Dream Dust", "Traumstaub", 1, 7, 12, 45, 0, 20, "inv_enchant_dustdream", 600, 300, 0.01),
    (16204, "Illusion Dust", "Illusionsstaub", 1, 7, 12, 55, 0, 20, "inv_enchant_dustillusion", 1500, 500, 0.03),
    (10938, "Lesser Magic Essence", "Geringe Magieessenz", 2, 7, 12, 10, 0, 10, "inv_enchant_essencemagicsmall", 180, 160, 0.0),
    (16202, "Lesser Eternal Essence", "Geringe ewige Essenz", 2, 7, 12, 55, 0, 10, "inv_enchant_essenceeternalsmall", 2500, 120, 0.0),
    (16203, "Greater Eternal Essence", "Große ewige Essenz", 2, 7, 12, 55, 0, 10, "inv_enchant_essenceeternallarge", 7800, 140, 0.04),
    (14344, "Large Brilliant Shard", "Großer glänzender Splitter", 3, 7, 12, 55, 0, 20, "inv_enchant_shardbrilliantlarge", 26000, 90, 0.02),
    (20725, "Nexus Crystal", "Nexuskristall", 4, 7, 12, 60, 0, 20, "inv_enchant_shardnexuslarge", 95000, 12, 0.0),
    # elemental 7/10
    (7076, "Essence of Earth", "Essenz der Erde", 2, 7, 10, 45, 0, 10, "inv_misc_gem_emerald_03", 4500, 70, 0.0),
    (7078, "Essence of Fire", "Essenz des Feuers", 2, 7, 10, 45, 0, 10, "inv_misc_gem_ruby_02", 7500, 40, 0.0),
    (7080, "Essence of Water", "Essenz des Wassers", 2, 7, 10, 45, 0, 10, "inv_misc_gem_sapphire_02", 5500, 50, 0.0),
    (7082, "Essence of Air", "Essenz der Luft", 2, 7, 10, 45, 0, 10, "inv_misc_gem_diamond_01", 9000, 30, 0.0),
    (12808, "Essence of Undeath", "Essenz des Untodes", 2, 7, 10, 50, 0, 10, "inv_misc_gem_ruby_03", 6500, 60, 0.0),
    (7068, "Elemental Fire", "Elementarfeuer", 1, 7, 10, 40, 0, 10, "inv_elemental_primal_fire", 900, 300, 0.0),
    (7067, "Elemental Earth", "Elementarerde", 1, 7, 10, 40, 0, 10, "inv_elemental_primal_earth", 700, 250, 0.0),
    # cooking 7/8
    (12208, "Tender Wolf Meat", "Zartes Wolfsfleisch", 1, 7, 8, 40, 0, 10, "inv_misc_food_14", 400, 300, 0.0),
    (3667, "Tender Crocolisk Meat", "Zartes Krokiliskenfleisch", 1, 7, 8, 30, 0, 10, "inv_misc_food_14", 140, 200, 0.0),
    (12205, "White Spider Meat", "Weißes Spinnenfleisch", 1, 7, 8, 40, 0, 10, "inv_misc_food_14", 220, 180, 0.0),
    (13888, "Darkclaw Lobster", "Dunkelklauenhummer", 1, 7, 8, 55, 0, 20, "inv_misc_food_33", 600, 160, 0.0),
    (13889, "Raw Whitescale Salmon", "Roher Weißschuppenlachs", 1, 7, 8, 50, 0, 20, "inv_misc_fish_20", 300, 220, 0.0),
    # potions 0/1
    (118, "Minor Healing Potion", "Schwacher Heiltrank", 1, 0, 1, 5, 1, 5, "inv_potion_49", 40, 300, 0.0),
    (858, "Lesser Healing Potion", "Geringer Heiltrank", 1, 0, 1, 13, 3, 5, "inv_potion_50", 110, 260, 0.0),
    (929, "Healing Potion", "Heiltrank", 1, 0, 1, 22, 12, 5, "inv_potion_51", 260, 220, 0.0),
    (1710, "Greater Healing Potion", "Großer Heiltrank", 1, 0, 1, 31, 21, 5, "inv_potion_52", 520, 200, 0.0),
    (3928, "Superior Healing Potion", "Überragender Heiltrank", 1, 0, 1, 45, 35, 5, "inv_potion_53", 900, 240, 0.0),
    (13446, "Major Healing Potion", "Erheblicher Heiltrank", 1, 0, 1, 55, 45, 5, "inv_potion_54", 3800, 300, "spike"),
    (13444, "Major Mana Potion", "Erheblicher Manatrank", 1, 0, 1, 59, 49, 5, "inv_potion_76", 5200, 260, 0.02),
    (6149, "Greater Mana Potion", "Großer Manatrank", 1, 0, 1, 41, 31, 5, "inv_potion_73", 1100, 180, 0.0),
    (13457, "Greater Fire Protection Potion", "Großer Feuerschutztrank", 1, 0, 1, 58, 48, 5, "inv_potion_24", 9000, 80, 0.06),
    (5634, "Free Action Potion", "Trank der freien Aktion", 1, 0, 1, 30, 20, 5, "inv_potion_04", 4200, 50, 0.0),
    # elixirs 0/2, flasks 0/3
    (13452, "Elixir of the Mongoose", "Elixier des Mungos", 1, 0, 2, 56, 46, 5, "inv_potion_32", 16000, 70, 0.03),
    (9187, "Elixir of Greater Agility", "Elixier der großen Beweglichkeit", 1, 0, 2, 48, 38, 5, "inv_potion_94", 3500, 90, 0.0),
    (13454, "Greater Arcane Elixir", "Großes arkanes Elixier", 1, 0, 2, 57, 47, 5, "inv_potion_25", 9500, 60, 0.02),
    (9206, "Elixir of Giants", "Elixier der Riesen", 1, 0, 2, 48, 38, 5, "inv_potion_61", 4800, 70, 0.0),
    (13510, "Flask of the Titans", "Fläschchen der Titanen", 1, 0, 3, 60, 50, 1, "inv_potion_62", 420000, 8, 0.0),
    (13511, "Flask of Distilled Wisdom", "Fläschchen der destillierten Weisheit", 1, 0, 3, 60, 50, 1, "inv_potion_97", 380000, 6, 0.0),
    (13512, "Flask of Supreme Power", "Fläschchen der obersten Macht", 1, 0, 3, 60, 50, 1, "inv_potion_41", 450000, 5, 0.0),
    # food 0/5, bandages 0/7, other 0/8
    (13931, "Nightfin Soup", "Nachtflossensuppe", 1, 0, 5, 55, 35, 20, "inv_drink_17", 900, 160, 0.0),
    (12218, "Monster Omelet", "Monsteromelett", 1, 0, 5, 50, 40, 20, "inv_misc_food_14", 1100, 120, 0.0),
    (13813, "Blessed Sunfruit Juice", "Gesegneter Sonnenfruchtsaft", 1, 0, 5, 55, 45, 20, "inv_drink_12", 600, 60, 0.0),
    (14529, "Runecloth Bandage", "Runenstoffverband", 1, 0, 7, 56, 0, 20, "inv_misc_bandage_11", 600, 400, 0.02),
    (8545, "Heavy Mageweave Bandage", "Schwerer Magiestoffverband", 1, 0, 7, 46, 0, 20, "inv_misc_bandage_19", 350, 250, 0.0),
    (20748, "Brilliant Mana Oil", "Glänzendes Manaöl", 1, 0, 8, 60, 45, 1, "inv_potion_100", 140000, 7, 0.0),
    # bags 1/0
    (4500, "Traveler's Backpack", "Reiserucksack", 2, 1, 0, 45, 0, 1, "inv_misc_bag_09", 95000, 20, 0.0),
    (14046, "Runecloth Bag", "Runenstofftasche", 2, 1, 0, 55, 0, 1, "inv_misc_bag_10", 180000, 30, 0.02),
    (10050, "Mageweave Bag", "Magiestofftasche", 1, 1, 0, 40, 0, 1, "inv_misc_bag_10_green", 60000, 40, 0.0),
    (4245, "Small Silk Pack", "Kleiner Seidenrucksack", 1, 1, 0, 35, 0, 1, "inv_misc_bag_08", 35000, 30, 0.0),
    (14156, "Bottomless Bag", "Bodenlose Tasche", 3, 1, 0, 60, 0, 1, "inv_misc_bag_13", 950000, 2, 0.0),
    # recipes 9/x
    (13518, "Recipe: Flask of Supreme Power", "Rezept: Fläschchen der obersten Macht", 3, 9, 6, 60, 0, 1, "inv_scroll_06", 1200000, 1, 0.0),
    (12682, "Plans: Thorium Armor", "Pläne: Thoriumrüstung", 2, 9, 4, 50, 0, 1, "inv_scroll_03", 85000, 3, 0.0),
    (16218, "Formula: Enchant Bracer - Superior Stamina", "Formel: Armschiene - Überragende Ausdauer", 2, 9, 8, 58, 0, 1, "inv_scroll_03", 240000, 2, 0.0),
    # gear 2/x, 4/x (two of them random-suffix)
    (1728, "Teebu's Blazing Longsword", "Teebus flammendes Langschwert", 4, 2, 7, 63, 58, 1, "inv_sword_29", 3600000, 1, 0.0),
    (14551, "Edgemaster's Handguards", "Handschutz des Klingenmeisters", 4, 4, 3, 62, 0, 1, "inv_gauntlets_31", 2500000, 1, 0.0),
    (15216, "Rune Sword", "Runenschwert", 2, 2, 7, 42, 37, 1, "inv_sword_36", 160000, 1, "suffix"),
    (15281, "Glowstar Rod", "Glühsternrute", 2, 2, 10, 52, 47, 1, "inv_staff_08", 210000, 1, "suffix"),
    (14427, "Mystical Robe", "Mystische Robe", 2, 4, 1, 55, 50, 1, "inv_chest_cloth_45", 110000, 1, 0.0),
    # misc 15/x, projectiles 6/x
    (8494, "Parrot Cage (Hyacinth Macaw)", "Papageienkäfig (Hyazinth-Ara)", 3, 15, 2, 30, 0, 1, "inv_box_petcarrier_01", 9000000, 1, "rare"),
    (8491, "Cat Carrier (Black Tabby)", "Katzentransportkorb (Schwarze Tigerkatze)", 1, 15, 2, 20, 0, 1, "inv_box_petcarrier_01", 600000, 1, "rare"),
    (15997, "Thorium Shells", "Thoriumpatronen", 1, 6, 3, 57, 52, 200, "inv_ammo_bullet_02", 9, 9000, 0.0),
    (11285, "Jagged Arrow", "Gezackter Pfeil", 1, 6, 2, 40, 30, 200, "inv_ammo_arrow_02", 5, 12000, 0.0),
]
SUFFIXES = (-12, -19, -26, -40)
NAMELESS = (19019, 21877)    # on the AH, but no member had its name yet: the site must cope


def price_at(item, t, rng):
    """unit price (copper) for an item at time t"""
    base, trend = item[10], item[12]
    day = (t - (END - DAYS * 86400)) / 86400
    if trend == "spike":                  # flat, then a jump in the last ~8 hours
        f = 1.0 + (0.45 if END - t < 8 * H else 0.0)
    elif trend == "fall":                 # slides down after day 5
        f = 1.0 if day < 5 else 1.0 - 0.06 * (day - 5)
    elif isinstance(trend, float):
        f = (1 + trend) ** day
    else:
        f = 1.0
    hour = time.gmtime(t).tm_hour
    evening = 1.0 + 0.04 * math.sin((hour - 13) / 24 * 2 * math.pi)   # a bit dearer in the evening
    return max(1, int(base * f * evening * rng.uniform(0.94, 1.06)))


def line_for(key, item, t, rng, mult=1.0):
    p = price_at(item, t, rng) * mult
    units = max(1, int(item[11] * rng.uniform(0.6, 1.3)))
    if item[12] == "spike" and END - t < 8 * H:
        units = max(1, units // 3)      # supply dried up
    stack = item[8]
    listings = max(1, min(units, int(units / max(1, stack * rng.uniform(0.3, 0.9))) + rng.randint(0, 3)))
    steps, left, price = [], units, p
    for _ in range(min(10, listings)):
        n = max(1, int(left * rng.uniform(0.05, 0.25))) if len(steps) < 9 else left
        n = min(n, left)
        steps.append((int(price), n))
        left -= n
        price = max(price * rng.uniform(1.01, 1.08), int(price) + 1)
        if left <= 0:
            break
    lo = steps[0][0]
    cum, p10, med = 0, None, None
    for pr, n in steps:
        cum += n
        if p10 is None and cum >= units * 0.1:
            p10 = pr
        if med is None and cum >= units * 0.5:
            med = pr
    p10, med = p10 or steps[-1][0], med or steps[-1][0]
    if left > 0:
        med = max(med, int(steps[-1][0] * 1.1))
    row = f"{key},{lo},{p10},{med},{units},{listings}"
    if listings > 1:
        row += "," + ";".join(f"{a}*{b}" for a, b in steps)
    return row


def upload(store, sid, t, lines, cov, member):
    scan = {"id": sid, "t": t, "cov": cov, "data": "\n".join(lines), "items": len(lines)}
    day = time.strftime("%Y-%m-%d/%H", time.gmtime(t))
    store.put(f"raw/scans/{day}/{sid}.json.gz", gzip.compress(json.dumps(
        {"received": t, "member": member, "scan": scan}).encode()))


def names_files(store):
    for loc, col in (("enUS", 1), ("deDE", 2)):
        names = {}
        for it in ITEMS:
            names[str(it[0])] = "|".join(str(x) for x in (it[col], it[3], it[4], it[5], it[6], it[7], it[8]))
        store.put(f"raw/names/{loc}/sample-2026-11-01.json.gz",
                  gzip.compress(json.dumps({"names": names}, ensure_ascii=False).encode()))


def main():
    rng = random.Random(7)
    members = ["Salty Dayn", "Mira", "Grubnak", "Zuljin Fan", "Teelicht", "Krakatau", "Ondra"]
    with tempfile.TemporaryDirectory() as tmp:
        names_files(LocalStore(tmp))
        start = END - (DAYS * 24 - 1) * H
        for h in range(start, END + H, H):
            hour = time.gmtime(h).tm_hour
            n = rng.choice((0, 1, 1, 2)) if 2 <= hour <= 7 else rng.choice((1, 2, 2, 3, 3, 4))
            store = LocalStore(tmp)
            for i in range(n):
                t = h + rng.randint(60, 3500)
                outlier = rng.random() < 0.03
                cov = rng.choice((1.0, 1.0, 1.0, 0.97, 0.62))
                lines = []
                for it in ITEMS:
                    if it[12] == "rare" and rng.random() < 0.85:
                        continue
                    if rng.random() > cov:
                        continue
                    keys = [f"{it[0]}:{s}" for s in SUFFIXES if rng.random() < 0.5] if it[12] == "suffix" else [str(it[0])]
                    for k in keys:
                        lines.append(line_for(k, it, t, rng, 2.2 if outlier else 1.0))
                for nid in NAMELESS:
                    if rng.random() < 0.5:
                        v = rng.randint(8000, 12000)
                        lines.append(f"{nid},{v},{v},{v},1,1")
                upload(store, f"{rng.getrandbits(48):012x}-{t}", t, lines, cov, rng.choice(members))
            process.run(store, now=h + 3000)

        src = Path(tmp) / "out"
        dst = OUT / "out"
        if dst.exists():
            shutil.rmtree(dst)
        dst.mkdir(parents=True)
        for f in ("latest.json", "names.json"):
            shutil.copy(src / f, dst / f)
        shutil.copytree(src / "history", dst / "history")
        shutil.copytree(src / "daily", dst / "daily")

    # icons: not in names.json yet (planned: the hourly job adds them). Sample has them already.
    names = json.loads((dst / "names.json").read_text())
    for it in ITEMS:
        names[str(it[0])]["icon"] = it[9]
    (dst / "names.json").write_text(json.dumps(names, ensure_ascii=False, separators=(",", ":")))

    # spark: last 24 hours of the market price (p10) per item, oldest first, null = no scan that hour.
    # Not in the live latest.json yet (planned addition to jobs/process.py); the sample has it already.
    latest = json.loads((dst / "latest.json").read_text())
    hist = {}
    for day_dir in sorted((dst / "history").iterdir()):
        for f in day_dir.iterdir():
            for k, per_hour in json.loads(f.read_text()).items():
                hist.setdefault(k, {}).update(per_hour)
    last = latest["lastScanHour"]
    for k, row in latest["items"].items():
        per_hour = hist.get(k, {})
        row["spark"] = [per_hour.get(str(last - i * H), [None, None])[1] for i in range(23, -1, -1)]
    (dst / "latest.json").write_text(json.dumps(latest, separators=(",", ":")))

    # stress test: a latest.json with ~15,000 items (no history, no names for the extras)
    latest = json.loads((dst / "latest.json").read_text())
    for i in range(15000):
        k = str(30000 + i)
        p = rng.randint(5, 2_000_000)
        latest["items"][k] = {"min": p, "p10": int(p * 1.03), "med": int(p * 1.1), "units": rng.randint(1, 900),
                              "listings": rng.randint(1, 60), "seen": END - rng.choice((0, 0, 0, H, 5 * H, 30 * H)),
                              "ch6": round(rng.uniform(-0.3, 0.3), 4), "ch24": round(rng.uniform(-0.5, 0.5), 4)}
    (OUT / "stress").mkdir(parents=True, exist_ok=True)
    (OUT / "stress" / "latest.json").write_text(json.dumps(latest, separators=(",", ":")))
    print("items:", len(json.loads((dst / "latest.json").read_text())["items"]),
          "history days:", len(list((dst / "history").iterdir())))


if __name__ == "__main__":
    main()
