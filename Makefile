NAME=vBox-Menu
DOMAIN=juliosejas98gmail.com

all: 
	mkdir -p ./dist
	cp -r src/* ./dist
	@if [ -d ./dist/schemas ]; then \
		glib-compile-schemas ./dist/schemas; \
	fi


$(NAME).zip: all
	cd dist && zip ../$(NAME).zip -9r .

pack: $(NAME).zip

install: $(NAME).zip
	@touch ~/.local/share/gnome-shell/extensions/$(NAME)@$(DOMAIN)
	@rm -rf ~/.local/share/gnome-shell/extensions/$(NAME)@$(DOMAIN)
	@mv dist ~/.local/share/gnome-shell/extensions/$(NAME)@$(DOMAIN)

clean:
	@rm -rf dist $(NAME).zip